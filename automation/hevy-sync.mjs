// =============================================================
// Hevy -> dashboard sync. Standalone, driven by launchd — no Claude
// Code involved at runtime, same shape as garmin-cron-sync.mjs.
//
// HEVY_API_KEY is read from automation/.env (gitignored) and never
// touches the browser: this script runs locally, computes a small
// read-only summary, and pushes it to the SAME Supabase app_state
// table gym.html reads via the standard sync.js path (initCloudSync),
// so it needs to write the same __sync-wrapped shape sync.js produces
// — see js/heatmap.js's comment history tonight for why a writer that
// skips that wrapper silently destroys the other side's reconciliation
// metadata (a JSONB upsert replaces the whole column, it doesn't merge).
//
// Flow: Hevy API -> this script -> Supabase app_state('hevy') -> sync.js
//       -> gym.html (read-only; nothing here writes back to Hevy).
//
// First run: full sync via GET /v1/workouts (paginated, max 10/page).
// Every run after: GET /v1/workouts/events?since=<last sync> — updates
// and deletes only, so a normal run touches a handful of rows, not the
// whole history. Local cache (automation/tmp/hevy-workouts.json, git-
// ignored) holds the full deduped-by-id workout list this builds up
// from; the summary pushed to Supabase is computed fresh from it every
// run, so a partial/incremental local cache still produces a correct
// summary.
// =============================================================
'use strict';

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(__dirname, '.env');
const CACHE_FILE = path.join(__dirname, 'tmp', 'hevy-workouts.json');
const STATE_FILE = path.join(__dirname, 'tmp', 'hevy-sync-state.json');
const LOG_PREFIX = () => '[' + new Date().toISOString() + ']';

// ---------- .env (no dependency — just KEY=value lines) ----------
function loadEnv() {
  if (!existsSync(ENV_FILE)) return;
  const lines = readFileSync(ENV_FILE, 'utf8').split('\n');
  for (const line of lines) {
    const s = line.trim();
    if (!s || s.startsWith('#')) continue;
    const eq = s.indexOf('=');
    if (eq === -1) continue;
    const key = s.slice(0, eq).trim();
    let val = s.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}
loadEnv();

const HEVY_API_KEY = process.env.HEVY_API_KEY;
const SUPABASE_URL = 'https://itidzioouqjbwnyvekkw.supabase.co';
const SUPABASE_KEY = 'sb_publishable_Eb38zFsU1V6OUxXzFd8ysg_AgMn6Zzt';
const APP_KEY = 'hevy';
const SYNCED_KEY = 'hevy_v1';

if (!HEVY_API_KEY) {
  console.error(LOG_PREFIX(), 'HEVY_API_KEY not set — create automation/.env with HEVY_API_KEY=<your key>. Exiting.');
  process.exit(1);
}

mkdirSync(path.join(__dirname, 'tmp'), { recursive: true });

// ---------- Hevy API ----------
const HEVY_BASE = 'https://api.hevyapp.com';

async function hevyFetch(pathAndQuery, attempt = 1) {
  const res = await fetch(HEVY_BASE + pathAndQuery, {
    headers: { 'api-key': HEVY_API_KEY, 'Accept': 'application/json' },
  });
  if (res.status === 401) {
    console.error(LOG_PREFIX(), 'Hevy API key rejected (401) — check automation/.env. Not touching the local cache.');
    process.exit(1);
  }
  if (res.status === 429) {
    if (attempt > 5) throw new Error('Hevy rate limit — gave up after 5 retries');
    const retryAfter = Number(res.headers.get('retry-after')) || Math.min(30, 2 ** attempt);
    console.error(LOG_PREFIX(), 'Rate limited, retrying in', retryAfter, 's');
    await new Promise((r) => setTimeout(r, retryAfter * 1000));
    return hevyFetch(pathAndQuery, attempt + 1);
  }
  if (!res.ok) {
    throw new Error('Hevy API ' + res.status + ' on ' + pathAndQuery);
  }
  return res.json();
}

async function fetchAllWorkouts() {
  const all = [];
  let page = 1, pageCount = 1;
  do {
    const data = await hevyFetch('/v1/workouts?page=' + page + '&pageSize=10');
    all.push(...(data.workouts || []));
    pageCount = data.page_count || 1;
    page++;
  } while (page <= pageCount);
  return all;
}

async function fetchEventsSince(sinceIso) {
  const updated = [];
  const deletedIds = [];
  let page = 1, pageCount = 1;
  do {
    const data = await hevyFetch(
      '/v1/workouts/events?page=' + page + '&pageSize=10&since=' + encodeURIComponent(sinceIso)
    );
    for (const ev of data.events || []) {
      if (ev.type === 'updated' && ev.workout) updated.push(ev.workout);
      else if (ev.type === 'deleted' && ev.id) deletedIds.push(ev.id);
    }
    pageCount = data.page_count || 1;
    page++;
  } while (page <= pageCount);
  return { updated, deletedIds };
}

// ---------- local cache (dedupe by id, source of truth for the summary) ----------
function loadCache() {
  if (!existsSync(CACHE_FILE)) return {};
  try { return JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { return {}; }
}
function saveCache(byId) {
  writeFileSync(CACHE_FILE, JSON.stringify(byId));
}
function loadState() {
  if (!existsSync(STATE_FILE)) return { lastSyncedAt: null };
  try { return JSON.parse(readFileSync(STATE_FILE, 'utf8')); } catch { return { lastSyncedAt: null }; }
}
function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state));
}

// ---------- summary computation ----------
function setVolumeKg(set) {
  if (set.type === 'warmup') return 0;
  return (set.weight_kg || 0) * (set.reps || 0);
}
function workoutVolumeKg(w) {
  let v = 0;
  for (const ex of w.exercises || []) for (const s of ex.sets || []) v += setVolumeKg(s);
  return Math.round(v);
}
function workoutDurationMin(w) {
  if (!w.start_time || !w.end_time) return null;
  const ms = new Date(w.end_time) - new Date(w.start_time);
  return ms > 0 ? Math.round(ms / 60000) : null;
}
function dateKey(iso) { return iso ? iso.slice(0, 10) : null; }
function isoWeekOf(d) {
  const dt = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const dayNum = dt.getUTCDay() || 7;
  dt.setUTCDate(dt.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(dt.getUTCFullYear(), 0, 1));
  return dt.getUTCFullYear() + '-W' + Math.ceil((((dt - yearStart) / 86400000) + 1) / 7);
}

// Current streak = consecutive calendar days with at least one workout,
// counting backward from today or yesterday (today not having a workout
// yet doesn't break a streak that's still "alive" until the day ends).
function computeStreak(sortedDatesDesc) {
  const daySet = new Set(sortedDatesDesc);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  let cursor = new Date(today);
  if (!daySet.has(dateKey(cursor.toISOString()))) cursor.setDate(cursor.getDate() - 1);
  let streak = 0;
  while (daySet.has(dateKey(cursor.toISOString()))) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

// Per exercise: best single-set weight (simple, honest PR — not an
// estimated 1RM formula) and whether the most recent session beat the
// session before it, for a "trending up" signal without a full chart.
function computeExerciseProgress(workouts) {
  const byExercise = new Map(); // title -> [{date, best}]
  for (const w of workouts) {
    const d = dateKey(w.start_time);
    for (const ex of w.exercises || []) {
      let best = 0;
      for (const s of ex.sets || []) {
        if (s.type === 'warmup') continue;
        if ((s.weight_kg || 0) > best) best = s.weight_kg;
      }
      if (best <= 0) continue;
      if (!byExercise.has(ex.title)) byExercise.set(ex.title, []);
      byExercise.get(ex.title).push({ date: d, best });
    }
  }
  const out = [];
  byExercise.forEach((entries, title) => {
    entries.sort((a, b) => (a.date < b.date ? -1 : 1));
    const pr = entries.reduce((m, e) => Math.max(m, e.best), 0);
    const last = entries[entries.length - 1];
    const prev = entries.length > 1 ? entries[entries.length - 2] : null;
    out.push({
      title,
      prKg: pr,
      lastKg: last.best,
      lastDate: last.date,
      trend: prev ? (last.best > prev.best ? 'up' : last.best < prev.best ? 'down' : 'flat') : 'flat',
      sessionCount: entries.length,
    });
  });
  // Most-trained exercises first — that's what "key" progressions means
  // here, not every exercise ever logged once.
  out.sort((a, b) => b.sessionCount - a.sessionCount);
  return out.slice(0, 6);
}

function buildSummary(byId) {
  const workouts = Object.values(byId).sort((a, b) => (a.start_time < b.start_time ? 1 : -1));
  const now = new Date();
  const weekKey = isoWeekOf(now);
  const workoutsThisWeek = workouts.filter((w) => isoWeekOf(new Date(w.start_time)) === weekKey).length;

  const uniqueDatesDesc = [...new Set(workouts.map((w) => dateKey(w.start_time)))].sort().reverse();
  const streak = computeStreak(uniqueDatesDesc);

  const recent = workouts.slice(0, 8).map((w) => ({
    id: w.id,
    title: w.title,
    date: dateKey(w.start_time),
    durationMin: workoutDurationMin(w),
    exerciseCount: (w.exercises || []).length,
    volumeKg: workoutVolumeKg(w),
  }));

  // Workouts/week over the last 8 weeks, oldest first — enough for "am I
  // consistent lately", not a full history chart.
  const perWeek = [];
  for (let i = 7; i >= 0; i--) {
    const d = new Date(now); d.setDate(d.getDate() - i * 7);
    const wk = isoWeekOf(d);
    perWeek.push(workouts.filter((w) => isoWeekOf(new Date(w.start_time)) === wk).length);
  }

  return {
    lastSyncedAt: now.toISOString(),
    totalWorkouts: workouts.length,
    workoutsThisWeek,
    streak,
    lastWorkout: workouts[0] ? { title: workouts[0].title, date: dateKey(workouts[0].start_time) } : null,
    recent,
    workoutsPerWeek: perWeek,
    exercises: computeExerciseProgress(workouts.slice(0, 60)), // recent ~2-3 months is plenty for "trending"
  };
}

// ---------- push to Supabase, preserving/merging __sync metadata ----------
async function pushSummary(summary) {
  const getRes = await fetch(
    SUPABASE_URL + '/rest/v1/app_state?select=data&key=eq.' + APP_KEY,
    { headers: { apikey: SUPABASE_KEY, Authorization: 'Bearer ' + SUPABASE_KEY } }
  );
  let meta = { deleted: {}, updatedAt: {} };
  if (getRes.ok) {
    const rows = await getRes.json();
    const existingMeta = rows[0] && rows[0].data && rows[0].data.__sync;
    if (existingMeta && typeof existingMeta === 'object') {
      meta = { deleted: existingMeta.deleted || {}, updatedAt: existingMeta.updatedAt || {} };
    }
  }
  meta.updatedAt[SYNCED_KEY] = Date.now();

  const payload = { [SYNCED_KEY]: summary, __sync: meta };
  const putRes = await fetch(SUPABASE_URL + '/rest/v1/app_state?on_conflict=key', {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({ key: APP_KEY, data: payload, updated_at: new Date().toISOString() }),
  });
  if (!putRes.ok) {
    const body = await putRes.text().catch(() => '');
    throw new Error('Supabase push failed: ' + putRes.status + ' ' + body);
  }
}

// ---------- main ----------
async function main() {
  const state = loadState();
  const byId = loadCache();

  if (!state.lastSyncedAt) {
    console.log(LOG_PREFIX(), 'No local state — running a full sync.');
    const all = await fetchAllWorkouts();
    for (const w of all) byId[w.id] = w;
    console.log(LOG_PREFIX(), 'Full sync fetched', all.length, 'workouts.');
  } else {
    const { updated, deletedIds } = await fetchEventsSince(state.lastSyncedAt);
    for (const w of updated) byId[w.id] = w; // upsert — same id overwrites, never duplicates
    for (const id of deletedIds) delete byId[id];
    console.log(LOG_PREFIX(), 'Incremental sync:', updated.length, 'updated,', deletedIds.length, 'deleted.');
  }

  saveCache(byId);
  const summary = buildSummary(byId);
  await pushSummary(summary);
  saveState({ lastSyncedAt: summary.lastSyncedAt });
  console.log(LOG_PREFIX(), 'Pushed summary:', summary.totalWorkouts, 'total workouts,', summary.workoutsThisWeek, 'this week, streak', summary.streak + 'd.');
}

main().catch((err) => {
  console.error(LOG_PREFIX(), 'Sync failed:', err && err.message || err);
  process.exit(1);
});
