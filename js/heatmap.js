// =============================================================
// Consistency heatmap — Goals / Water / Night / Run / Gym, last 63 days.
// Read-only against every other module's keys: this only reads what
// goals.js/night-sleep.js/water.js/running.js/week-planner.js already
// write, on the same calendar-date axis each of them already keys its
// data by.
// =============================================================
(function () {
  'use strict';

  const DAYS = 63;
  const TRACKS = [
    { id: 'goals', label: 'Goals', hue: 'var(--success)' },
    { id: 'water', label: 'Water', hue: '#4FA8E0' },
    { id: 'night', label: 'Night', hue: 'var(--warning)' },
    { id: 'run',   label: 'Run',   hue: 'var(--run)' },
    { id: 'gym',   label: 'Gym',   hue: '#B98AE0' }
  ];
  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

  function pad2(n) { return String(n).padStart(2, '0'); }
  function dateToKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function storeGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }

  // Oldest first, today last — every track reads off this same axis so
  // the grid is one shared calendar, not four independently-scrolled ones.
  function buildDates() {
    const out = [];
    const now = new Date();
    for (let i = DAYS - 1; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      out.push(dateToKey(d));
    }
    return out;
  }

  // Shared by Goals and Night: both are a done/total ratio over that
  // day's list. r<=0 still gets level 1, not 0 — logged-but-missed and
  // never-opened are different information and must not collapse.
  function ratioLevel(done, total) {
    if (!total) return 0;
    const r = done / total;
    if (r <= 0) return 1;
    if (r >= 1) return 5;
    if (r < 1 / 3) return 2;
    if (r < 2 / 3) return 3;
    return 4;
  }

  function goalsLevel(dateKey) {
    const list = storeGet('goals:' + dateKey);
    if (!Array.isArray(list) || list.length === 0) return { level: 0, detail: null };
    const done = list.filter(function (g) { return g && g.done; }).length;
    return { level: ratioLevel(done, list.length), detail: done + '/' + list.length + ' goals' };
  }

  function nightLevel(dateKey) {
    const list = storeGet('nightroutine:' + dateKey);
    if (!Array.isArray(list) || list.length === 0) return { level: 0, detail: null };
    const done = list.filter(function (g) { return g && g.done; }).length;
    return { level: ratioLevel(done, list.length), detail: done + '/' + list.length + ' night routine' };
  }

  // po_water_v1 is one object, not a per-date key — load it once per
  // render rather than once per cell.
  let waterState = null;
  function loadWaterState() {
    if (!waterState) waterState = storeGet('po_water_v1') || {};
    return waterState;
  }
  function waterTargetMl(state) {
    return state.useManualTarget ? Math.max(1, state.manualTargetMl || 3000) : 3000;
  }
  function waterLevel(dateKey) {
    const state = loadWaterState();
    const servings = (state.logs && state.logs[dateKey]) || 0;
    // water.js deletes a date's entry once it hits 0, so an absent key
    // and "logged, then undone back to zero" are indistinguishable —
    // both read as level 0 here, which is the data model's limit, not
    // a heatmap bug.
    if (!servings) return { level: 0, detail: null };
    const bottleMl = state.bottleMl || 500;
    const target = Math.ceil(waterTargetMl(state) / bottleMl);
    const ratio = servings / Math.max(1, target);
    const level = ratio >= 1 ? 5 : Math.min(4, Math.max(1, Math.ceil(ratio * 4)));
    return { level: level, detail: servings + '/' + target + ' bottles' };
  }

  // run:runs can hold more than one entry for the same date (a double
  // day) — summed, since the band is about that day's total volume.
  let runsByDate = null;
  function loadRunsByDate() {
    if (runsByDate) return runsByDate;
    const runs = storeGet('run:runs');
    runsByDate = {};
    (Array.isArray(runs) ? runs : []).forEach(function (r) {
      if (!r || !r.date) return;
      runsByDate[r.date] = (runsByDate[r.date] || 0) + (Number(r.distanceKm) || 0);
    });
    return runsByDate;
  }
  // Distance bands, not a target — a rest day is correct on a training
  // plan, so "no run" is level 0 (no data), never a failure colour.
  function runLevel(dateKey) {
    const km = loadRunsByDate()[dateKey];
    if (!km) return { level: 0, detail: null };
    let level;
    if (km >= 15) level = 5;
    else if (km >= 10) level = 4;
    else if (km >= 5) level = 3;
    else level = 2;
    return { level: level, detail: km.toFixed(1) + ' km' };
  }

  // Same isoWeekKey math as js/week-planner.js — duplicated rather than
  // shared, matching this file's existing pattern of small self-contained
  // date helpers (see pad2/dateToKey above) over a cross-module utility
  // for something this size.
  function isoWeekKey(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return d.getUTCFullYear() + '-W' + pad2(weekNo);
  }
  function parseYMD(s) { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }

  let doneDays = null;
  function loadDoneDays() {
    if (!doneDays) doneDays = storeGet('po_coach_workout_done') || {};
    return doneDays;
  }
  // weekplan:<isoWeek> holds one plan object per week, keyed by date —
  // cached per isoWeek within a render so 63 days only ever touch each
  // week's plan once, not 63 separate localStorage reads.
  let weekPlanCache = null;
  function plannedSplitFor(dateKey) {
    const wk = isoWeekKey(parseYMD(dateKey));
    if (!(wk in weekPlanCache)) weekPlanCache[wk] = storeGet('weekplan:' + wk) || {};
    const v = weekPlanCache[wk][dateKey];
    const splits = Array.isArray(v) ? v : (v ? [v] : []);
    const real = splits.filter(function (s) { return s && s !== 'rest'; });
    return real.length ? real : null;
  }
  // Binary, not a ratio — Mark Complete is one tap, no partial credit to
  // measure. Level 1 (planned, not done) vs level 0 (nothing planned,
  // i.e. a rest day) draws the same distinction the Run row's "no run
  // is level 0" comment does: a rest day isn't a missed day.
  function gymLevel(dateKey) {
    const done = loadDoneDays();
    const planned = plannedSplitFor(dateKey);
    if (done[dateKey]) {
      return { level: 5, detail: (planned ? planned.join('+') + ' day — ' : '') + 'completed' };
    }
    if (planned) {
      return { level: 1, detail: planned.join('+') + ' day — planned, not logged' };
    }
    return { level: 0, detail: null };
  }

  const LEVEL_FN = { goals: goalsLevel, water: waterLevel, night: nightLevel, run: runLevel, gym: gymLevel };

  function monthLabel(dateKey) {
    const p = dateKey.split('-').map(Number);
    return MONTHS[p[1] - 1];
  }

  function computeRow(track, dates) {
    const cells = dates.map(function (dk) {
      const r = LEVEL_FN[track.id](dk);
      return { date: dk, level: r.level, detail: r.detail };
    });
    const metOrBeat = cells.filter(function (c) { return c.level >= 4; }).length;
    const pct = Math.round((metOrBeat / cells.length) * 100);
    let streak = 0;
    for (let i = cells.length - 1; i >= 0; i--) {
      if (cells[i].level >= 4) streak++; else break;
    }
    return { cells: cells, pct: pct, streak: streak };
  }

  function escapeAttr(s) { return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;'); }
  function cellTitle(cell) {
    return cell.level === 0 ? cell.date + ' — no data' : cell.date + ' — ' + cell.detail;
  }

  function render() {
    const host = document.getElementById('hmGrid');
    if (!host) return;
    waterState = null; runsByDate = null; doneDays = null; weekPlanCache = {}; // fresh read on every render
    const dates = buildDates();

    // One label per date where the month changes from the previous
    // column, blank everywhere else, so it doesn't repeat 63 times.
    let monthsHtml = '';
    let lastMonth = null;
    dates.forEach(function (dk) {
      const m = monthLabel(dk);
      monthsHtml += '<span class="hm-month">' + (m !== lastMonth ? m : '') + '</span>';
      lastMonth = m;
    });

    let rowsHtml = '';
    TRACKS.forEach(function (track) {
      const row = computeRow(track, dates);
      let cellsHtml = '';
      row.cells.forEach(function (c) {
        cellsHtml += '<span class="hm-cell hm-l' + c.level + '" title="' + escapeAttr(cellTitle(c)) + '"></span>';
      });
      const streakHtml = row.streak > 1 ? '<em>' + row.streak + 'd streak</em>' : '';
      rowsHtml +=
        '<div class="hm-row" style="--hm-hue:' + track.hue + '">' +
          '<div class="hm-label">' + track.label + '</div>' +
          '<div class="hm-cells">' + cellsHtml + '</div>' +
          '<div class="hm-stat"><b>' + row.pct + '%</b>' + streakHtml + '</div>' +
        '</div>';
    });

    host.innerHTML =
      '<div class="hm-scroll"><div class="hm-inner" style="--hm-days:' + dates.length + '">' +
        '<div class="hm-months">' + monthsHtml + '</div>' +
        rowsHtml +
      '</div></div>' +
      '<div class="hm-foot"><div class="hm-legend"><span>Less</span>' +
        '<span class="hm-cell hm-l1"></span><span class="hm-cell hm-l2"></span>' +
        '<span class="hm-cell hm-l3"></span><span class="hm-cell hm-l4"></span>' +
        '<span class="hm-cell hm-l5"></span><span>More</span></div></div>';
  }

  render();
  window.addEventListener('storage', render);
  window.addEventListener('goals-changed', render);
})();
