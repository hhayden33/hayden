#!/usr/bin/env node
// =============================================================
// Standalone Garmin -> dashboard sync. No Claude Code involved —
// this is driven by launchd (see run-garmin-sync.sh + the two
// com.hayden.garminsync.*.plist jobs) or can be run by hand.
//
// It talks to the SAME Garmin MCP server Claude Code uses
// (@nicolasvegam/garmin-connect-mcp), via the official MCP client
// SDK, spawned as a plain child process over stdio — the MCP
// protocol was designed for exactly this: any program can be a
// client, not just an AI host. Credentials come from Keychain, never
// from a file or an env var baked into this script.
//
// On any failure (auth, MCP, malformed response) this aborts BEFORE
// calling garmin-sync.py, so a bad run never touches the data
// already in Supabase — existing dashboard data is only ever added
// to or refreshed, never wiped by a failed sync.
//
// DEPLOYMENT NOTE: this actually RUNS from ~/.garmin-dashboard-automation
// (outside ~/Desktop), not from this repo checkout. macOS blocks
// launchd-spawned processes from reading ANY file under ~/Desktop
// (~/Documents, ~/Downloads too) — confirmed by direct test — regardless
// of where the reading process itself lives, and there's no command-line
// way to grant that access (it's a GUI-only TCC permission). So `install.sh`
// copies this file + garmin-sync.py out to that external directory, and
// THAT copy is what launchd actually executes. This file (the one in git)
// is the source of truth — re-run install.sh after editing it.
// =============================================================
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { execFileSync } from 'node:child_process';
import { writeFileSync, mkdirSync, appendFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// garmin-sync.py lives right next to this script in the deployed copy
// (install.sh puts them side by side in ~/.garmin-dashboard-automation),
// but one directory up when run straight from the repo checkout
// (automation/garmin-cron-sync.mjs, garmin-sync.py at the repo root) —
// support both so this file works identically in either location.
const REPO_DIR = existsSync(path.join(__dirname, 'garmin-sync.py'))
  ? __dirname
  : path.resolve(__dirname, '..');
const TMP_DIR = path.join(__dirname, 'tmp');
const LOG_FILE = path.join(__dirname, 'logs', 'garmin-sync.log');

mkdirSync(TMP_DIR, { recursive: true });
mkdirSync(path.join(__dirname, 'logs'), { recursive: true });

function log(msg) {
  const line = `[${new Date().toISOString()}] ${msg}`;
  console.log(line);
  appendFileSync(LOG_FILE, line + '\n');
}

function keychainGet(service) {
  return execFileSync('security', ['find-generic-password', '-s', service, '-w'], {
    encoding: 'utf8',
  }).trim();
}

function classifyType(a) {
  const dist = a.distanceKm || 0;
  const label = a.trainingEffectLabel || '';
  if (dist >= 18) return 'Long Run';
  if (label === 'VO2MAX') return 'Intervals';
  if (label === 'LACTATE_THRESHOLD' || label === 'TEMPO') return 'Tempo';
  if (label === 'RECOVERY') return 'Recovery';
  return 'Easy Run';
}

function toSlimActivity(a) {
  const start = a.startTimeLocal || '';
  return {
    garminActivityId: a.activityId,
    date: start.slice(0, 10),
    startTimeLocal: start,
    name: a.activityName,
    distanceKm: Math.round(((a.distance || 0) / 1000) * 1000) / 1000,
    durationSec: Math.round(a.duration || 0),
    movingDurationSec: a.movingDuration != null ? Math.round(a.movingDuration) : null,
    avgHr: a.averageHR ?? null,
    maxHr: a.maxHR ?? null,
    elevationM: a.elevationGain ?? null,
    vo2Max: a.vO2MaxValue ?? null,
    trainingLoad: a.activityTrainingLoad != null ? Math.round(a.activityTrainingLoad) : null,
    trainingEffectLabel: a.trainingEffectLabel ?? null,
    calories: a.calories ?? null,
  };
}

// Garmin's personal-record typeIds are stable/well-known: 3=5K, 4=10K,
// 5=half marathon, 6=marathon, 7=longest run (meters). Everything else
// (steps, floors, etc.) isn't running data and is ignored.
function extractPbs(records) {
  const pbs = {};
  let longestRunKm = null;
  for (const r of records || []) {
    if (r.typeId === 3) pbs.fiveK = Math.round(r.value);
    else if (r.typeId === 4) pbs.tenK = Math.round(r.value);
    else if (r.typeId === 5) pbs.half = Math.round(r.value);
    else if (r.typeId === 6) pbs.marathon = Math.round(r.value);
    else if (r.typeId === 7) longestRunKm = Math.round((r.value / 1000) * 100) / 100;
  }
  return { pbs, longestRunKm };
}

// Garmin's raw sleepLevels segments use numeric activityLevel codes rather
// than named stages — verified empirically against this account's own
// dailySleepDTO.{deep,light,rem,awake}SleepSeconds totals (they sum to an
// exact match): 0=deep, 1=light, 2=rem, 3=awake. Coalesces consecutive
// same-stage segments into { stage, durMin } for a compact timeline —
// matches the shape main.html's (removed, to-be-rebuilt) sleep UI already
// expects for its per-segment timeline render.
const SLEEP_STAGE_BY_LEVEL = { 0: 'deep', 1: 'light', 2: 'rem', 3: 'awake' };
function toStages(sleepLevels) {
  const out = [];
  for (const seg of sleepLevels || []) {
    const stage = SLEEP_STAGE_BY_LEVEL[seg.activityLevel];
    if (!stage) continue;
    const durMin = (new Date(seg.endGMT + 'Z') - new Date(seg.startGMT + 'Z')) / 60000;
    const last = out[out.length - 1];
    if (last && last.stage === stage) last.durMin += durMin;
    else out.push({ stage, durMin: Math.round(durMin * 10) / 10 });
  }
  return out;
}
function toHHMM(localTimestampMs) {
  if (localTimestampMs == null) return null;
  // *TimestampLocal fields are epoch millis representing local wall-clock
  // time encoded as if UTC (same convention already relied on elsewhere in
  // this pipeline) — format with getUTC* so no host-timezone conversion
  // double-applies.
  const d = new Date(localTimestampMs);
  return String(d.getUTCHours()).padStart(2, '0') + ':' + String(d.getUTCMinutes()).padStart(2, '0');
}
// One entry per night, keyed by Garmin's own calendarDate (the wake-up
// day) — matches getActiveDateString()'s 6am-boundary convention in the
// normal case (waking after 6am), so no separate date math is needed here.
function toSleepEntries(rangeResult) {
  const out = {};
  for (const { date, data } of rangeResult || []) {
    const dto = data && data.dailySleepDTO;
    if (!dto || !dto.sleepTimeSeconds) continue; // no real sleep recorded that night
    out[date] = {
      bedTime: toHHMM(dto.sleepStartTimestampLocal),
      wakeTime: toHHMM(dto.sleepEndTimestampLocal),
      hours: Math.round((dto.sleepTimeSeconds / 3600) * 100) / 100,
      quality: null, // manual-only field; Garmin sync never sets it
      score: dto.sleepScores?.overall?.value ?? null,
      source: 'garmin',
      stages: toStages(data.sleepLevels),
    };
  }
  return out;
}

// get_sleep_data_range times out (MCP request timeout) on wide ranges —
// Garmin's API apparently can't assemble e.g. 100 nights fast enough for
// one request. Chunk into smaller windows and fetch sequentially instead
// of raising the timeout, which just delays hitting the same wall on a
// still-wider ask later. One chunk failing (e.g. a transient timeout on
// just that slice) doesn't abort the rest — it's logged and skipped.
async function fetchSleepRangeChunked(callTool, startDate, endDate, log, chunkDays = 14) {
  const start = new Date(startDate + 'T00:00:00Z');
  const end = new Date(endDate + 'T00:00:00Z');
  const out = [];
  for (let chunkStart = new Date(start); chunkStart <= end; ) {
    const chunkEnd = new Date(Math.min(chunkStart.getTime() + (chunkDays - 1) * 86400000, end.getTime()));
    const s = chunkStart.toISOString().slice(0, 10);
    const e = chunkEnd.toISOString().slice(0, 10);
    try {
      const chunk = await callTool('get_sleep_data_range', { startDate: s, endDate: e });
      if (Array.isArray(chunk)) out.push(...chunk);
    } catch (err) {
      log(`WARN: get_sleep_data_range chunk ${s}..${e} failed (non-fatal): ${err.message}`);
    }
    chunkStart = new Date(chunkEnd.getTime() + 86400000);
  }
  return out;
}

async function main() {
  log('=== Garmin sync starting ===');

  let email, password;
  try {
    email = keychainGet('garmin-dashboard-sync-email');
    password = keychainGet('garmin-dashboard-sync-password');
  } catch (e) {
    log(`FATAL: could not read credentials from Keychain — ${e.message}`);
    log('Aborting. Existing dashboard data left untouched.');
    process.exit(1);
  }

  const transport = new StdioClientTransport({
    command: 'npx',
    args: ['-y', '@nicolasvegam/garmin-connect-mcp'],
    env: { ...process.env, GARMIN_EMAIL: email, GARMIN_PASSWORD: password },
    stderr: 'pipe',
  });
  const client = new Client({ name: 'garmin-cron-sync', version: '1.0.0' });

  async function callTool(name, args = {}) {
    const res = await client.callTool({ name, arguments: args });
    if (res.isError) {
      const text = res.content?.map((c) => c.text).join(' ') || 'unknown error';
      throw new Error(`${name}: ${text}`);
    }
    const text = res.content?.[0]?.text;
    if (text == null) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  let activities, vo2max, trainingStatus, restingHr, personalRecords, sleepRange;
  try {
    await client.connect(transport);
    log('Connected to Garmin MCP (session reused from ~/.garmin-mcp if valid, else fresh login).');

    activities = await callTool('get_activities', { activityType: 'running', limit: 15 });
    vo2max = await callTool('get_vo2max', {}).catch((e) => {
      log(`WARN: get_vo2max failed (non-fatal): ${e.message}`);
      return null;
    });
    trainingStatus = await callTool('get_training_status', {}).catch((e) => {
      log(`WARN: get_training_status failed (non-fatal): ${e.message}`);
      return null;
    });
    restingHr = await callTool('get_resting_heart_rate', {}).catch((e) => {
      log(`WARN: get_resting_heart_rate failed (non-fatal): ${e.message}`);
      return null;
    });
    personalRecords = await callTool('get_personal_records', {}).catch((e) => {
      log(`WARN: get_personal_records failed (non-fatal): ${e.message}`);
      return null;
    });
    // Lookback window (not just last night) so a sync that was down for a
    // day or two — or Garmin's own upload lag — still catches up rather
    // than permanently missing a night. Each night is keyed by date, so
    // re-fetching ones already synced is harmless. Default 3 days for the
    // routine automated run; override with SLEEP_LOOKBACK_DAYS for a
    // one-off wider backfill (e.g. `SLEEP_LOOKBACK_DAYS=7 node garmin-cron-sync.mjs`).
    const sleepLookbackDays = parseInt(process.env.SLEEP_LOOKBACK_DAYS, 10) || 3;
    const today = new Date().toISOString().slice(0, 10);
    const lookbackStart = new Date(Date.now() - sleepLookbackDays * 86400000).toISOString().slice(0, 10);
    sleepRange = await fetchSleepRangeChunked(callTool, lookbackStart, today, log);
  } catch (e) {
    log(`FATAL: Garmin MCP/auth failure — ${e.message}`);
    log('Aborting before touching Supabase. Existing dashboard data left untouched.');
    try {
      await client.close();
    } catch {}
    process.exit(1);
  }
  await client.close().catch(() => {});

  // The one thing that must be a real array — everything else degrades
  // gracefully (missing wellness fields just don't get updated, see the
  // merge-not-replace logic in garmin-sync.py).
  if (!Array.isArray(activities)) {
    log(`FATAL: get_activities returned ${typeof activities}, not an array — aborting without touching Supabase.`);
    process.exit(1);
  }
  log(`Fetched ${activities.length} recent running activities from Garmin.`);

  const slimActivities = activities.map(toSlimActivity);

  const vo2 = vo2max?.[0]?.generic?.vo2MaxValue
    ?? trainingStatus?.mostRecentVO2Max?.generic?.vo2MaxValue
    ?? null;
  const vo2Precise = vo2max?.[0]?.generic?.vo2MaxPreciseValue
    ?? trainingStatus?.mostRecentVO2Max?.generic?.vo2MaxPreciseValue
    ?? null;

  const deviceLoads = trainingStatus?.mostRecentTrainingStatus?.latestTrainingStatusData;
  const loadEntry = deviceLoads ? Object.values(deviceLoads)[0] : null;
  const feedbackPhrase = loadEntry?.trainingStatusFeedbackPhrase || '';
  const acute = loadEntry?.acuteTrainingLoadDTO;

  const rhrEntry = restingHr?.allMetrics?.metricsMap?.WELLNESS_RESTING_HEART_RATE?.[0];

  const { pbs, longestRunKm } = extractPbs(personalRecords);

  const wellness = {
    asOfDate: new Date().toISOString().slice(0, 10),
    vo2Max: vo2,
    vo2MaxPrecise: vo2Precise,
    trainingStatus: feedbackPhrase ? feedbackPhrase.split('_')[0] : null,
    trainingLoadAcute: acute?.dailyTrainingLoadAcute ?? null,
    trainingLoadChronic: acute?.dailyTrainingLoadChronic ?? null,
    acwr: acute?.dailyAcuteChronicWorkloadRatio ?? null,
    acwrStatus: acute?.acwrStatus ?? null,
    restingHr: rhrEntry?.value ?? null,
  };
  if (longestRunKm != null) wellness.longestRunAllTimeKm = longestRunKm;
  // Drop nulls so a merge-not-replace on the Python side never overwrites a
  // previously-known-good value with "we didn't get an answer this time".
  for (const k of Object.keys(wellness)) {
    if (wellness[k] == null) delete wellness[k];
  }

  const sleepEntries = toSleepEntries(sleepRange);

  const activitiesPath = path.join(TMP_DIR, 'activities.json');
  const wellnessPath = path.join(TMP_DIR, 'wellness.json');
  const pbsPath = path.join(TMP_DIR, 'pbs.json');
  const sleepPath = path.join(TMP_DIR, 'sleep.json');
  writeFileSync(activitiesPath, JSON.stringify(slimActivities, null, 1));
  writeFileSync(wellnessPath, JSON.stringify(wellness, null, 1));
  writeFileSync(pbsPath, JSON.stringify(pbs, null, 1));
  writeFileSync(sleepPath, JSON.stringify(sleepEntries, null, 1));

  log(`Wellness snapshot: ${JSON.stringify(wellness)}`);
  log(`Sleep nights fetched: ${Object.keys(sleepEntries).join(', ') || 'none'}`);

  try {
    const out = execFileSync(
      'python3',
      ['garmin-sync.py', activitiesPath, wellnessPath, pbsPath, sleepPath],
      { cwd: REPO_DIR, encoding: 'utf8' }
    );
    for (const line of out.trim().split('\n')) log(line);
    log('=== Garmin sync finished OK ===');
  } catch (e) {
    log(`FATAL: garmin-sync.py failed — ${e.stderr || e.message}`);
    process.exit(1);
  }
}

main().catch((e) => {
  log(`FATAL: unhandled error — ${e.stack || e.message}`);
  process.exit(1);
});
