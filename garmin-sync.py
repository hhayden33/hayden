#!/usr/bin/env python3
# =============================================================
# Garmin -> dashboard data layer.
#
# Garmin credentials never touch this file or the browser — only the
# Garmin MCP tools (available inside a Claude Code session) can reach
# Garmin's API. This script is the other half of the pipeline: it takes
# already-fetched Garmin JSON and merges it into the SAME Supabase
# `app_state` row running.html already syncs (key='running'), using the
# same publishable key already shipped client-side in sync.js/topbar.js.
#
# Garmin runs are tagged source='garmin' with a garminActivityId, so
# re-running this script is always safe (existing entries are skipped,
# manual entries are never touched). PBs are only filled in when the
# corresponding field is still empty, so a manually-entered PB is never
# clobbered by Garmin's.
#
# Flow: Garmin (MCP) -> this script -> Supabase app_state('running')
#       -> sync.js (unchanged) -> running.html / main.html (unchanged
#       render functions, reading run:runs / run:pbs / run:garminSnapshot)
#
# Usage:
#   python3 garmin-sync.py <activities.json> <wellness.json> [pbs.json]
#
# activities.json: array of objects with at least:
#   garminActivityId, date (YYYY-MM-DD), distanceKm, durationSec,
#   avgHr, maxHr, elevationM, vo2Max, trainingLoad, trainingEffectLabel, name
# wellness.json: object merged as-is into run:garminSnapshot
# pbs.json (optional): { fiveK, tenK, fifteenK, half, marathon, thirtyK,
#   fiftyK } in seconds — only fills currently-empty run:pbs fields
# =============================================================
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone

SUPABASE_URL = 'https://itidzioouqjbwnyvekkw.supabase.co'
SUPABASE_KEY = 'sb_publishable_Eb38zFsU1V6OUxXzFd8ysg_AgMn6Zzt'
APP_KEY = 'running'


def classify_type(a):
    dist = a.get('distanceKm') or 0
    label = a.get('trainingEffectLabel') or ''
    if dist >= 18:
        return 'Long Run'
    if label == 'VO2MAX':
        return 'Intervals'
    if label in ('LACTATE_THRESHOLD', 'TEMPO'):
        return 'Tempo'
    if label == 'RECOVERY':
        return 'Recovery'
    return 'Easy Run'


def build_notes(a):
    name = (a.get('name') or '').strip()
    # Garmin auto-names most runs "<City> Running" — not worth surfacing.
    # Custom names (e.g. "Melbourne - Speed") carry real info, keep those.
    if not name or (name.lower().endswith('running') and '-' not in name):
        return ''
    return name


def to_run_entry(a):
    # startTimeLocal is 'YYYY-MM-DD HH:MM:SS' — keep the time part so runs on
    # the same calendar date (common with Garmin: warmup/main/cooldown often
    # get logged as separate activities) sort correctly within that day.
    start = a.get('startTimeLocal') or ''
    time_part = start[11:] if len(start) > 11 else None
    return {
        'id': 'garmin_' + str(a['garminActivityId']),
        'garminActivityId': a['garminActivityId'],
        'date': a['date'],
        'time': time_part,
        'type': classify_type(a),
        'distanceKm': round(a.get('distanceKm') or 0, 2),
        'durationSec': round(a.get('durationSec') or 0),
        'movingDurationSec': round(a['movingDurationSec']) if a.get('movingDurationSec') is not None else None,
        'avgHr': a.get('avgHr'),
        'maxHr': a.get('maxHr'),
        'elevationM': round(a.get('elevationM') or 0),
        'calories': a.get('calories'),
        'vo2Max': a.get('vo2Max'),
        'trainingLoad': a.get('trainingLoad'),
        'trainingEffectLabel': a.get('trainingEffectLabel'),
        'source': 'garmin',
        'notes': build_notes(a),
    }


# Observed in practice (2026-09-02/03 automated runs): occasional
# ConnectionResetError against Supabase, transient — a bare retry
# succeeds. 3 attempts with a short backoff, nothing fancier needed for
# a job that only runs twice a day.
def _urlopen_with_retry(req, attempts=3, backoff_sec=2):
    last_err = None
    for attempt in range(1, attempts + 1):
        try:
            return urllib.request.urlopen(req)
        except (urllib.error.URLError, ConnectionError, TimeoutError) as e:
            last_err = e
            if attempt < attempts:
                time.sleep(backoff_sec * attempt)
    raise last_err


def supa_get(key):
    url = f'{SUPABASE_URL}/rest/v1/app_state?key=eq.{key}&select=data'
    req = urllib.request.Request(url, headers={
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
    })
    with _urlopen_with_retry(req) as r:
        rows = json.loads(r.read())
    return rows[0]['data'] if rows else {}


def supa_upsert(key, data):
    url = f'{SUPABASE_URL}/rest/v1/app_state?on_conflict=key'
    body = json.dumps({
        'key': key,
        'data': data,
        'updated_at': datetime.now(timezone.utc).isoformat(),
    }).encode()
    req = urllib.request.Request(url, data=body, method='POST', headers={
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
    })
    with _urlopen_with_retry(req) as r:
        return r.status


def main():
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)

    with open(sys.argv[1]) as f:
        activities = json.load(f)
    with open(sys.argv[2]) as f:
        wellness = json.load(f)
    pbs_in = {}
    if len(sys.argv) > 3:
        with open(sys.argv[3]) as f:
            pbs_in = json.load(f)

    current = supa_get(APP_KEY)
    existing = current.get('run:runs') or []
    manual = [r for r in existing if not r.get('garminActivityId')]
    by_activity_id = {r['garminActivityId']: r for r in existing if r.get('garminActivityId')}

    added, updated = 0, 0
    for a in activities:
        aid = a['garminActivityId']
        if aid in by_activity_id:
            updated += 1
        else:
            added += 1
        by_activity_id[aid] = to_run_entry(a)  # Garmin is authoritative for its own entries — always refresh

    runs = manual + list(by_activity_id.values())
    runs.sort(key=lambda r: r['date'] + ' ' + (r.get('time') or '00:00:00'))

    pbs = current.get('run:pbs') or {}
    pb_filled = []
    for k, v in pbs_in.items():
        if not pbs.get(k):
            pbs[k] = v
            pb_filled.append(k)

    # Merge, don't replace — a given run (e.g. an automated one that only
    # re-checks a subset of metrics) shouldn't blank out snapshot fields it
    # didn't recompute this time (e.g. the all-time longest-run PR).
    snapshot = current.get('run:garminSnapshot') or {}
    snapshot.update(wellness)

    current['run:runs'] = runs
    current['run:pbs'] = pbs
    current['run:garminSnapshot'] = snapshot

    supa_upsert(APP_KEY, current)
    print(f'Synced to Supabase app_state[{APP_KEY}].')
    print(f'  Runs: +{added} new, {updated} refreshed, {len(runs)} total.')
    print(f'  PBs filled from Garmin: {pb_filled or "none (already set or none provided)"}.')
    print(f'  Snapshot: {json.dumps(snapshot)}')


if __name__ == '__main__':
    main()
