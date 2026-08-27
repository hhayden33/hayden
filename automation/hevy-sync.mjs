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
//
// gym.html is an analytics dashboard, not a logger — everything below
// computes real numbers from the workout log (weekly volume, PR events,
// muscle-group set counts, exercise progressions). Nothing here invents
// a value: sections with too little data to compute honestly (e.g. a
// muscle-group breakdown before exercise templates are cached) come out
// as null/empty and gym.html renders an explicit "not enough data yet"
// state instead of a fake number.
// =============================================================
'use strict';

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(__dirname, '.env');
const CACHE_FILE = path.join(__dirname, 'tmp', 'hevy-workouts.json');
const STATE_FILE = path.join(__dirname, 'tmp', 'hevy-sync-state.json');
const TEMPLATES_FILE = path.join(__dirname, 'tmp', 'hevy-exercise-templates.json');
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

// Exercise templates map exercise_template_id -> primary_muscle_group, the
// only thing the Training Balance section needs. There are only a few
// hundred of these and they almost never change, so this is fetched in
// full (pageSize 100, a handful of requests) and cached rather than
// looked up per-exercise-id.
async function fetchAllExerciseTemplates() {
  const all = [];
  let page = 1, pageCount = 1;
  do {
    const data = await hevyFetch('/v1/exercise_templates?page=' + page + '&pageSize=100');
    all.push(...(data.exercise_templates || []));
    pageCount = data.page_count || 1;
    page++;
  } while (page <= pageCount);
  return all;
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

const TEMPLATES_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function loadTemplatesCache() {
  if (!existsSync(TEMPLATES_FILE)) return null;
  try { return JSON.parse(readFileSync(TEMPLATES_FILE, 'utf8')); } catch { return null; }
}
function saveTemplatesCache(cache) {
  writeFileSync(TEMPLATES_FILE, JSON.stringify(cache));
}
// Refetches when the cache is missing/stale, or when a workout references
// an exercise_template_id the cache has never seen (a new exercise used
// for the first time) — otherwise reuses the cached map untouched.
async function getExerciseTemplateMap(byId) {
  let cache = loadTemplatesCache();
  const usedIds = new Set();
  for (const w of Object.values(byId)) {
    for (const ex of w.exercises || []) {
      if (ex.exercise_template_id) usedIds.add(ex.exercise_template_id);
    }
  }
  const stale = !cache || (Date.now() - (cache.fetchedAt || 0)) > TEMPLATES_MAX_AGE_MS;
  const missingIds = cache ? [...usedIds].some((id) => !(id in cache.byId)) : true;
  if (stale || missingIds) {
    try {
      const templates = await fetchAllExerciseTemplates();
      const byIdMap = {};
      for (const t of templates) {
        if (!t.id) continue;
        byIdMap[t.id] = { title: t.title, primaryMuscleGroup: t.primary_muscle_group || null };
      }
      cache = { fetchedAt: Date.now(), byId: byIdMap };
      saveTemplatesCache(cache);
      console.log(LOG_PREFIX(), 'Refreshed exercise template cache:', templates.length, 'templates.');
    } catch (err) {
      console.error(LOG_PREFIX(), 'Exercise template fetch failed, falling back to cached copy if any:', err && err.message || err);
    }
  }
  return cache ? cache.byId : {};
}

// ---------- shared date/week helpers ----------
function pad2(n) { return String(n).padStart(2, '0'); }
function dateKey(iso) { return iso ? iso.slice(0, 10) : null; }
function parseYMD(s) { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
// Monday-start week, matching running.html's own mondayOf() so every page
// on the dashboard buckets weeks the same way.
function mondayOf(d) {
  const date = new Date(d);
  const day = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - day);
  date.setHours(0, 0, 0, 0);
  return date;
}
function addDays(d, n) { const out = new Date(d); out.setDate(out.getDate() + n); return out; }
function daysAgoKey(n) { return ymd(addDays(new Date(), -n)); }

// ---------- per-workout metrics ----------
function setVolumeKg(set) {
  if (set.type === 'warmup') return 0;
  return (set.weight_kg || 0) * (set.reps || 0);
}
function workoutVolumeKg(w) {
  let v = 0;
  for (const ex of w.exercises || []) for (const s of ex.sets || []) v += setVolumeKg(s);
  return Math.round(v);
}
function workoutSetCount(w) {
  let n = 0;
  for (const ex of w.exercises || []) n += (ex.sets || []).length;
  return n;
}
function workoutDurationMin(w) {
  if (!w.start_time || !w.end_time) return null;
  const ms = new Date(w.end_time) - new Date(w.start_time);
  return ms > 0 ? Math.round(ms / 60000) : null;
}

function sortedWorkouts(byId) {
  return Object.values(byId).sort((a, b) => (a.start_time < b.start_time ? 1 : -1)); // newest first
}

// ---------- 12-week consistency ----------
function computeConsistency(workoutsAsc, weeks) {
  const monday = mondayOf(new Date());
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const wkStart = addDays(monday, -7 * i);
    const wkEnd = addDays(wkStart, 6);
    const startKey = ymd(wkStart), endKey = ymd(wkEnd);
    const count = workoutsAsc.filter((w) => {
      const k = dateKey(w.start_time);
      return k >= startKey && k <= endKey;
    }).length;
    out.push({ weekStart: startKey, count });
  }
  const weeksActive = out.filter((w) => w.count > 0).length;
  const avgPerWeek = Math.round((out.reduce((s, w) => s + w.count, 0) / weeks) * 10) / 10;
  return { weeks: out, weeksActive, avgPerWeek };
}

// ---------- weekly training load ----------
function computeLoad(workoutsAsc, weeks) {
  const monday = mondayOf(new Date());
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const wkStart = addDays(monday, -7 * i);
    const wkEnd = addDays(wkStart, 6);
    const startKey = ymd(wkStart), endKey = ymd(wkEnd);
    const volumeKg = workoutsAsc
      .filter((w) => { const k = dateKey(w.start_time); return k >= startKey && k <= endKey; })
      .reduce((s, w) => s + workoutVolumeKg(w), 0);
    out.push({ weekStart: startKey, volumeKg });
  }
  const currentWeekVolumeKg = out.length ? out[out.length - 1].volumeKg : 0;
  const prevFour = out.slice(-5, -1);
  const prevFourWeekAvgKg = prevFour.length
    ? Math.round(prevFour.reduce((s, w) => s + w.volumeKg, 0) / prevFour.length)
    : 0;
  const trendPct = prevFourWeekAvgKg > 0
    ? Math.round(((currentWeekVolumeKg - prevFourWeekAvgKg) / prevFourWeekAvgKg) * 1000) / 10
    : null;
  const totalVolumeKg = out.reduce((s, w) => s + w.volumeKg, 0);
  return { weeks: out, currentWeekVolumeKg, prevFourWeekAvgKg, trendPct, totalVolumeKg };
}

// ---------- strength progression for key (most-trained) exercises ----------
// Per exercise: best non-warmup set weight per session, most-trained
// exercises first (that's what "key movements" means here — not every
// exercise ever logged once). Progress is measured over whatever window
// of sessions falls in the last 12 weeks so the reported "over N weeks"
// is always the true span of the data behind it, never a fixed claim.
function computeExerciseProgress(workoutsAsc) {
  const byExercise = new Map(); // title -> [{date, bestKg}] ascending
  for (const w of workoutsAsc) {
    const d = dateKey(w.start_time);
    for (const ex of w.exercises || []) {
      let best = 0;
      for (const s of ex.sets || []) {
        if (s.type === 'warmup') continue;
        if ((s.weight_kg || 0) > best) best = s.weight_kg;
      }
      if (best <= 0) continue;
      if (!byExercise.has(ex.title)) byExercise.set(ex.title, []);
      byExercise.get(ex.title).push({ date: d, bestKg: best });
    }
  }
  const cutoff84 = daysAgoKey(84);
  const out = [];
  byExercise.forEach((entries, title) => {
    entries.sort((a, b) => (a.date < b.date ? -1 : 1));
    const prKg = entries.reduce((m, e) => Math.max(m, e.bestKg), 0);
    const currentBestKg = entries[entries.length - 1].bestKg;

    let windowed = entries.filter((e) => e.date >= cutoff84);
    if (windowed.length < 2) windowed = entries.slice(-8);

    let progressPct = null, progressWeeks = null;
    if (windowed.length >= 2) {
      const first = windowed[0], last = windowed[windowed.length - 1];
      progressPct = first.bestKg > 0 ? Math.round(((last.bestKg - first.bestKg) / first.bestKg) * 1000) / 10 : null;
      progressWeeks = Math.max(1, Math.round((parseYMD(last.date) - parseYMD(first.date)) / (7 * 86400000)));
    }
    const last = entries[entries.length - 1];
    const prev = entries.length > 1 ? entries[entries.length - 2] : null;
    const trend = prev ? (last.bestKg > prev.bestKg ? 'up' : last.bestKg < prev.bestKg ? 'down' : 'flat') : 'flat';

    out.push({
      title,
      sessionCount: entries.length,
      currentBestKg,
      prKg,
      progressPct,
      progressWeeks,
      trend,
      history: windowed.slice(-12),
    });
  });
  out.sort((a, b) => b.sessionCount - a.sessionCount);
  return out.slice(0, 6);
}

// ---------- personal records ----------
// A PR is a session that beats every prior session for that exercise —
// the exercise's very first logged session sets the baseline, it isn't
// itself a "record" yet.
function computePersonalRecords(workoutsAsc) {
  const byExercise = new Map(); // title -> [{date, bestKg}] ascending
  for (const w of workoutsAsc) {
    const d = dateKey(w.start_time);
    for (const ex of w.exercises || []) {
      let best = 0;
      for (const s of ex.sets || []) {
        if (s.type === 'warmup') continue;
        if ((s.weight_kg || 0) > best) best = s.weight_kg;
      }
      if (best <= 0) continue;
      if (!byExercise.has(ex.title)) byExercise.set(ex.title, []);
      byExercise.get(ex.title).push({ date: d, bestKg: best });
    }
  }
  const events = [];
  byExercise.forEach((entries, title) => {
    entries.sort((a, b) => (a.date < b.date ? -1 : 1));
    let runningMax = entries[0].bestKg;
    for (let i = 1; i < entries.length; i++) {
      if (entries[i].bestKg > runningMax) {
        events.push({ exercise: title, weightKg: entries[i].bestKg, date: entries[i].date });
        runningMax = entries[i].bestKg;
      }
    }
  });
  events.sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
  const cutoff30 = daysAgoKey(30);
  const last30Days = events.filter((e) => e.date >= cutoff30).length;
  return { all: events, recent: events.slice(0, 10), last30Days };
}

// ---------- training balance (muscle-group set counts) ----------
const MUSCLE_BUCKETS = {
  chest: { group: 'Chest', region: 'upper' },
  lats: { group: 'Back', region: 'upper' },
  upper_back: { group: 'Back', region: 'upper' },
  traps: { group: 'Back', region: 'upper' },
  lower_back: { group: 'Back', region: 'upper' },
  shoulders: { group: 'Shoulders', region: 'upper' },
  biceps: { group: 'Arms', region: 'upper' },
  triceps: { group: 'Arms', region: 'upper' },
  forearms: { group: 'Arms', region: 'upper' },
  quadriceps: { group: 'Quads', region: 'lower' },
  hamstrings: { group: 'Hamstrings', region: 'lower' },
  glutes: { group: 'Glutes', region: 'lower' },
  abductors: { group: 'Glutes', region: 'lower' },
  adductors: { group: 'Glutes', region: 'lower' },
  calves: { group: 'Calves', region: 'lower' },
};
const BALANCE_GROUP_ORDER = ['Chest', 'Back', 'Shoulders', 'Arms', 'Quads', 'Hamstrings', 'Glutes', 'Calves'];
const BALANCE_GROUP_REGION = {
  Chest: 'upper', Back: 'upper', Shoulders: 'upper', Arms: 'upper',
  Quads: 'lower', Hamstrings: 'lower', Glutes: 'lower', Calves: 'lower',
};
const BALANCE_WINDOW_DAYS = 56;

function computeBalance(workoutsAsc, templatesById) {
  const available = templatesById && Object.keys(templatesById).length > 0;
  const counts = {};
  BALANCE_GROUP_ORDER.forEach((g) => { counts[g] = 0; });
  if (available) {
    const cutoff = daysAgoKey(BALANCE_WINDOW_DAYS);
    for (const w of workoutsAsc) {
      if (dateKey(w.start_time) < cutoff) continue;
      for (const ex of w.exercises || []) {
        const tpl = ex.exercise_template_id && templatesById[ex.exercise_template_id];
        const bucket = tpl && tpl.primaryMuscleGroup && MUSCLE_BUCKETS[tpl.primaryMuscleGroup];
        if (!bucket) continue;
        const workingSets = (ex.sets || []).filter((s) => s.type !== 'warmup').length;
        counts[bucket.group] += workingSets;
      }
    }
  }
  const groups = BALANCE_GROUP_ORDER.map((g) => ({
    group: g,
    region: BALANCE_GROUP_REGION[g],
    sets: counts[g],
  }));
  const totalSets = groups.reduce((s, g) => s + g.sets, 0);
  return { available, windowDays: BALANCE_WINDOW_DAYS, groups, totalSets };
}

// ---------- monthly summary ----------
function monthBounds(offsetMonths) {
  const now = new Date();
  const y = now.getFullYear(), m = now.getMonth() + offsetMonths;
  const first = new Date(y, m, 1);
  const prefix = first.getFullYear() + '-' + pad2(first.getMonth() + 1);
  return prefix;
}
function computeMonthStats(workoutsAsc, prEvents, monthPrefix) {
  const inMonth = workoutsAsc.filter((w) => dateKey(w.start_time).slice(0, 7) === monthPrefix);
  return {
    workouts: inMonth.length,
    trainingTimeMin: inMonth.reduce((s, w) => s + (workoutDurationMin(w) || 0), 0),
    sets: inMonth.reduce((s, w) => s + workoutSetCount(w), 0),
    volumeKg: inMonth.reduce((s, w) => s + workoutVolumeKg(w), 0),
    prs: prEvents.filter((e) => e.date.slice(0, 7) === monthPrefix).length,
  };
}
function computeMonthly(workoutsAsc, prEvents) {
  const current = computeMonthStats(workoutsAsc, prEvents, monthBounds(0));
  const previous = computeMonthStats(workoutsAsc, prEvents, monthBounds(-1));
  const volumeDeltaPct = previous.volumeKg > 0
    ? Math.round(((current.volumeKg - previous.volumeKg) / previous.volumeKg) * 1000) / 10
    : null;
  const workoutsDeltaPct = previous.workouts > 0
    ? Math.round(((current.workouts - previous.workouts) / previous.workouts) * 1000) / 10
    : null;
  return { current, previous, volumeDeltaPct, workoutsDeltaPct };
}

// ---------- training insight (deterministic, not AI-generated prose) ----------
function computeInsights(consistency, exercises, balance) {
  const candidates = [];

  const weeks = consistency.weeks;
  const last4 = weeks.slice(-4).reduce((s, w) => s + w.count, 0);
  const prior4 = weeks.slice(-8, -4).reduce((s, w) => s + w.count, 0);
  if (prior4 > 0) {
    const pct = Math.round(((last4 - prior4) / prior4) * 1000) / 10;
    if (Math.abs(pct) >= 8) {
      candidates.push('Consistency is ' + (pct > 0 ? 'up' : 'down') + ' ' + Math.abs(pct) + '% over the last four weeks.');
    }
  }

  const progressing = exercises
    .filter((e) => e.progressPct != null && e.progressPct >= 5 && e.progressWeeks >= 3)
    .sort((a, b) => b.progressPct - a.progressPct)[0];
  if (progressing) {
    candidates.push(
      progressing.title + ' has increased ' + progressing.progressPct + '% over ' +
      progressing.progressWeeks + ' week' + (progressing.progressWeeks === 1 ? '' : 's') + '.'
    );
  }

  if (balance.available && balance.totalSets >= 10) {
    const sorted = balance.groups.slice().sort((a, b) => b.sets - a.sets);
    const [top1, top2] = sorted;
    if (top1.sets > 0 && top2.sets > 0) {
      const share = Math.round(((top1.sets + top2.sets) / balance.totalSets) * 1000) / 10;
      if (share >= 35) {
        const scope = top1.region === top2.region ? (top1.region === 'upper' ? 'upper-body' : 'lower-body') : 'training';
        candidates.push(top1.group + ' and ' + top2.group + ' account for ' + share + '% of your ' + scope + ' sets.');
      }
    }
  }

  return candidates.slice(0, 2);
}

// ---------- summary orchestration ----------
const CONSISTENCY_WEEKS = 12;
const LOAD_WEEKS = 12;

function buildSummary(byId, templatesById) {
  const workoutsDesc = sortedWorkouts(byId); // newest first
  const workoutsAsc = workoutsDesc.slice().reverse();
  const now = new Date();

  const consistency = computeConsistency(workoutsAsc, CONSISTENCY_WEEKS);
  const load = computeLoad(workoutsAsc, LOAD_WEEKS);
  const exercises = computeExerciseProgress(workoutsAsc);
  const personalRecords = computePersonalRecords(workoutsAsc);
  const balance = computeBalance(workoutsAsc, templatesById);
  const monthly = computeMonthly(workoutsAsc, personalRecords.all);

  const thisMonthPrefix = monthBounds(0);
  const workoutsThisMonth = workoutsAsc.filter((w) => dateKey(w.start_time).slice(0, 7) === thisMonthPrefix).length;

  const recent = workoutsDesc.slice(0, 8).map((w) => ({
    id: w.id,
    title: w.title,
    date: dateKey(w.start_time),
    durationMin: workoutDurationMin(w),
    exerciseCount: (w.exercises || []).length,
    setCount: workoutSetCount(w),
    volumeKg: workoutVolumeKg(w),
  }));

  const insights = computeInsights(consistency, exercises, balance);

  return {
    lastSyncedAt: now.toISOString(),
    totalWorkouts: workoutsAsc.length,
    workoutsThisWeek: consistency.weeks.length ? consistency.weeks[consistency.weeks.length - 1].count : 0,
    workoutsThisMonth,
    avgPerWeek: consistency.avgPerWeek,
    consistency,
    load,
    exercises,
    personalRecords: { recent: personalRecords.recent, last30Days: personalRecords.last30Days },
    balance,
    monthly,
    recent,
    insights,
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
  const templatesById = await getExerciseTemplateMap(byId);
  const summary = buildSummary(byId, templatesById);
  await pushSummary(summary);
  saveState({ lastSyncedAt: summary.lastSyncedAt });
  console.log(
    LOG_PREFIX(), 'Pushed summary:', summary.totalWorkouts, 'total workouts,',
    summary.workoutsThisWeek, 'this week,', summary.personalRecords.recent.length, 'recent PRs.'
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(LOG_PREFIX(), 'Sync failed:', err && err.message || err);
    process.exit(1);
  });
}

export { buildSummary };
