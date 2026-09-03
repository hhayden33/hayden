// =============================================================
// Sleep — a compact companion card beside Night Routine. Not a
// separate integration: reads the exact same app_state('sleep') row
// garmin-sync.py/automation/garmin-cron-sync.mjs already write to
// (sleep:<date> keys, synced via the 'sleep' channel registered in
// js/sync-register.js), which is the SAME data shape and Supabase row
// main.html's old sleep UI used before it was removed — re-adding the
// UI needed no new data plumbing, only this file.
//
// Entry shape written by the sync pipeline:
//   { bedTime, wakeTime, hours, quality, score, source: 'garmin'|'manual',
//     stages: [{ stage: 'deep'|'light'|'rem'|'awake', durMin }, ...] }
// stages is Garmin-only — manual/legacy entries (pre-dating the Garmin
// pipeline) have hours/bedTime/wakeTime but no stage breakdown, which
// this file treats as "not available" rather than inventing one.
// =============================================================
(function () {
  'use strict';

  const Dash = window.Dash;
  const storeGet = Dash.storeGet;
  const getActiveDateString = Dash.getActiveDateString;

  // No configurable sleep-target setting exists anywhere in this app yet
  // (unlike water's) — 8h matches the implicit baseline the old removed
  // sleep UI's own scoring used, and js/day-ring.js's own wake/bedtime
  // window (7:00-23:30) is consistent with an 8h night.
  const SLEEP_TARGET_HOURS = 8;

  const STAGE_LABELS = { deep: 'Deep', light: 'Light', rem: 'REM', awake: 'Awake' };
  const STAGE_ORDER = ['deep', 'light', 'rem', 'awake'];

  function sleepKey(date) { return 'sleep:' + date; }
  function getSleepEntry(date) {
    const e = storeGet(sleepKey(date));
    return (e && typeof e === 'object' && !Array.isArray(e)) ? e : null;
  }

  function fmtHM(hours) {
    if (hours == null || !isFinite(hours)) return '—';
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return h + 'h ' + m + 'm';
  }
  function fmtDurMin(totalMin) {
    const h = Math.floor(totalMin / 60);
    const m = Math.round(totalMin % 60);
    return h > 0 ? (h + 'h ' + m + 'm') : (m + 'm');
  }
  function fmtTime12(hhmm) {
    if (!hhmm || typeof hhmm !== 'string' || hhmm.indexOf(':') === -1) return null;
    const parts = hhmm.split(':').map(Number);
    const h = parts[0], m = parts[1];
    if (!isFinite(h) || !isFinite(m)) return null;
    const ampm = h >= 12 ? 'PM' : 'AM';
    let h12 = h % 12; if (h12 === 0) h12 = 12;
    return h12 + ':' + String(m).padStart(2, '0') + ' ' + ampm;
  }

  // Sums durMin per stage — only stages Garmin actually reported are
  // ever present in the result, never a zero-filled placeholder for a
  // stage that's missing.
  function stageTotals(stages) {
    if (!Array.isArray(stages) || !stages.length) return null;
    const totals = {};
    let any = false;
    stages.forEach(function (seg) {
      if (!seg || !STAGE_LABELS[seg.stage] || typeof seg.durMin !== 'number' || !(seg.durMin > 0)) return;
      totals[seg.stage] = (totals[seg.stage] || 0) + seg.durMin;
      any = true;
    });
    return any ? totals : null;
  }

  // Duration-relative-to-target only — deliberately not folding in
  // Garmin's own 0-100 score, per spec ("do not create a complicated
  // medical/readiness score").
  function computeStatus(hours) {
    if (hours == null || !isFinite(hours)) return null;
    const pct = hours / SLEEP_TARGET_HOURS;
    if (pct >= 1) return { label: 'Excellent', cls: 'sleep-excellent' };
    if (pct >= 0.85) return { label: 'Good', cls: 'sleep-good' };
    return { label: 'Below target', cls: 'sleep-below' };
  }

  function priorNightsHours(beforeDate, count) {
    const out = [];
    const base = new Date(beforeDate + 'T00:00:00');
    for (let i = 1; i <= count; i++) {
      const d = new Date(base);
      d.setDate(d.getDate() - i);
      const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      const e = getSleepEntry(key);
      if (e && typeof e.hours === 'number' && isFinite(e.hours)) out.push(e.hours);
    }
    return out;
  }

  function render() {
    const card = document.getElementById('sleepCard');
    if (!card) return;
    const empty = document.getElementById('sleepEmpty');
    const body = document.getElementById('sleepBody');

    const entry = getSleepEntry(getActiveDateString());
    if (!entry || typeof entry.hours !== 'number' || !isFinite(entry.hours)) {
      empty.style.display = 'block';
      body.style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    body.style.display = '';

    document.getElementById('sleepDuration').textContent = fmtHM(entry.hours);

    const statusEl = document.getElementById('sleepStatus');
    const status = computeStatus(entry.hours);
    if (status) {
      statusEl.textContent = status.label;
      statusEl.className = 'sleep-status ' + status.cls;
      statusEl.style.display = '';
    } else {
      statusEl.style.display = 'none';
    }

    // Garmin's own score, shown as-is — not used to compute Good/
    // Excellent/Below target above (that's duration-only, per spec),
    // and never present for a manual/legacy entry.
    const scoreEl = document.getElementById('sleepScore');
    if (typeof entry.score === 'number' && isFinite(entry.score)) {
      scoreEl.textContent = 'Score ' + Math.round(entry.score);
      scoreEl.style.display = '';
    } else {
      scoreEl.style.display = 'none';
    }

    const pct = Math.max(0, Math.min(100, Math.round(entry.hours / SLEEP_TARGET_HOURS * 100)));
    document.getElementById('sleepTargetFill').style.width = pct + '%';
    document.getElementById('sleepTargetLabel').textContent = fmtHM(entry.hours) + ' / ' + fmtHM(SLEEP_TARGET_HOURS);

    // 7-day average — only shown with at least 2 prior nights of real
    // data to compare against; a gappy history isn't padded with 0h
    // nights, those are just skipped.
    const compareEl = document.getElementById('sleepCompare');
    const prior = priorNightsHours(getActiveDateString(), 7);
    if (prior.length >= 2) {
      const avg = prior.reduce(function (a, b) { return a + b; }, 0) / prior.length;
      const diffMin = Math.round((entry.hours - avg) * 60);
      const magStr = Math.abs(diffMin) >= 60 ? fmtHM(Math.abs(diffMin) / 60) : Math.abs(diffMin) + 'm';
      compareEl.textContent = (diffMin === 0 ? 'Same as' : (diffMin > 0 ? '+' : '−') + magStr) + ' vs 7-day avg';
      compareEl.className = 'sleep-compare' + (diffMin > 0 ? ' sleep-compare-up' : '');
      compareEl.style.display = '';
    } else {
      compareEl.style.display = 'none';
    }

    const stageBar = document.getElementById('sleepStageBar');
    const stageList = document.getElementById('sleepStageList');
    const totals = stageTotals(entry.stages);
    if (totals) {
      const totalMin = STAGE_ORDER.reduce(function (s, k) { return s + (totals[k] || 0); }, 0);
      stageBar.innerHTML = '';
      stageList.innerHTML = '';
      STAGE_ORDER.forEach(function (stage) {
        const min = totals[stage];
        if (!min) return;
        const seg = document.createElement('div');
        seg.className = 'sleep-stage-seg sleep-stage-seg-' + stage;
        seg.style.flex = (min / totalMin) + ' 0 0';
        stageBar.appendChild(seg);

        const row = document.createElement('div');
        row.className = 'sleep-stage-row';
        const dot = document.createElement('span');
        dot.className = 'sleep-stage-dot sleep-stage-seg-' + stage;
        const name = document.createElement('span');
        name.className = 'sleep-stage-name';
        name.textContent = STAGE_LABELS[stage];
        const dur = document.createElement('span');
        dur.className = 'sleep-stage-dur';
        dur.textContent = fmtDurMin(min);
        row.appendChild(dot); row.appendChild(name); row.appendChild(dur);
        stageList.appendChild(row);
      });
      stageBar.style.display = 'flex';
      stageList.style.display = 'flex';
    } else {
      stageBar.style.display = 'none';
      stageList.style.display = 'none';
    }

    const timesEl = document.getElementById('sleepTimes');
    const bed = fmtTime12(entry.bedTime), wake = fmtTime12(entry.wakeTime);
    if (bed && wake) {
      timesEl.textContent = bed + ' → ' + wake;
      timesEl.style.display = '';
    } else {
      timesEl.style.display = 'none';
    }
  }

  window.Sleep = { render: render };
  render();
})();
