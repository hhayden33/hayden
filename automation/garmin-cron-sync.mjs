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

  let activities, vo2max, trainingStatus, restingHr, personalRecords;
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

  const activitiesPath = path.join(TMP_DIR, 'activities.json');
  const wellnessPath = path.join(TMP_DIR, 'wellness.json');
  const pbsPath = path.join(TMP_DIR, 'pbs.json');
  writeFileSync(activitiesPath, JSON.stringify(slimActivities, null, 1));
  writeFileSync(wellnessPath, JSON.stringify(wellness, null, 1));
  writeFileSync(pbsPath, JSON.stringify(pbs, null, 1));

  log(`Wellness snapshot: ${JSON.stringify(wellness)}`);

  try {
    const out = execFileSync(
      'python3',
      ['garmin-sync.py', activitiesPath, wellnessPath, pbsPath],
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
