// =============================================================
// Night Routine + Sleep — one module because they share the same
// active-day boundary and sit side by side in the same .dual-row.
// Exposes its two renderers so goals.js can re-run them when it
// notices the 6 AM boundary flip or a cross-tab storage write.
// =============================================================
(function () {
  'use strict';

  const Dash = window.Dash;
  const storeGet = Dash.storeGet;
  const storeSet = Dash.storeSet;
  const pad2 = Dash.pad2;
  const dateToKey = Dash.dateToKey;
  const getActiveDateString = Dash.getActiveDateString;
  const makeInlineEdit = Dash.makeInlineEdit;

  // ---------- Night Routine ----------
  const NIGHT_ROUTINE_ITEMS = [
    'Prepare clothes for tomorrow',
    'Pack work/gym bag',
    "Review tomorrow's schedule",
    'Complete remaining tasks',
    'Prepare water',
    'Charge Garmin/watch',
    'Brush teeth / skincare',
    'No phone',
    'Get into bed'
  ];
  function nightRoutineKey() { return 'nightroutine:' + getActiveDateString(); }
  // Same items every night, but a fresh (unchecked) list each active day —
  // carries a checked item's done state forward only if that exact item is
  // still checked from *before* the day boundary flipped (handles the page
  // just staying open across the 6 AM rollover).
  function getNightRoutine() {
    const key = nightRoutineKey();
    let list = storeGet(key);
    // Only seed the default 9 the first time this active day is seen —
    // once a list exists, a shorter one (after a delete) is left alone
    // instead of being topped back up to 9.
    if (!Array.isArray(list)) {
      list = NIGHT_ROUTINE_ITEMS.map(text => ({ text, done: false }));
      storeSet(key, list);
    }
    return list;
  }
  function setNightRoutine(list) { storeSet(nightRoutineKey(), list); }

  // ---------- Sleep ----------
  // Same 'sleep:<date>' shape a future Garmin sync could write into
  // directly (source:'garmin', hours set from Garmin's own duration
  // rather than computed from bed/wake here) — see the section comment
  // in the markup. Shares the same active-day boundary as Night
  // Routine (getActiveDateString()), so logging sleep after waking up
  // files under the night that just ended, not the new day starting.
  function sleepKey() { return 'sleep:' + getActiveDateString(); }
  function getSleep() {
    const s = storeGet(sleepKey());
    return (s && typeof s === 'object' && !Array.isArray(s))
      ? s : { bedTime: null, wakeTime: null, hours: null, quality: null, source: 'manual' };
  }
  function setSleep(data) { storeSet(sleepKey(), data); }
  // Hours between a bedtime and wake time, both 'HH:MM' — always treats
  // wake as the next clock time after bed, wrapping past midnight (23:15
  // -> 07:00 is 7h45m, not a negative span).
  function computeSleepHours(bedTime, wakeTime) {
    if (!bedTime || !wakeTime) return null;
    const [bh, bm] = bedTime.split(':').map(Number);
    const [wh, wm] = wakeTime.split(':').map(Number);
    let bedMin = bh * 60 + bm, wakeMin = wh * 60 + wm;
    if (wakeMin < bedMin) wakeMin += 24 * 60;
    return Math.round((wakeMin - bedMin) / 60 * 100) / 100;
  }
  function formatSleepHours(hours) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return h + 'h' + (m ? ' ' + m + 'm' : '');
  }
  const SLEEP_QUALITY_LABELS = { 1: 'poor night', 2: 'rough night', 3: 'okay night', 4: 'good night', 5: 'great night' };

  // ---------- Sleep Score ring ----------
  // s.score is Garmin-authoritative when a future sync sets it directly;
  // until then this is a plain estimate from what we actually collect —
  // hours slept (up to 70 of the 100 points, scaled against an 8h night)
  // plus the manual quality rating (up to 30, defaulting to a neutral
  // half-credit if no rating's been given yet). Never persisted — it's
  // recomputed on every render, so it can't drift from source data.
  const SLEEP_SCORE_BANDS = [
    { max: 49,  label: 'Poor',      color: 'var(--danger)' },
    { max: 69,  label: 'Fair',      color: 'var(--warning)' },
    { max: 84,  label: 'Good',      color: 'var(--success)' },
    { max: 100, label: 'Excellent', color: '#B98AE0' }
  ];
  function sleepScoreBand(score) {
    return SLEEP_SCORE_BANDS.find(b => score <= b.max) || SLEEP_SCORE_BANDS[SLEEP_SCORE_BANDS.length - 1];
  }
  function computeSleepScore(s) {
    if (s.score != null) return Math.max(0, Math.min(100, Math.round(s.score)));
    if (s.hours == null) return null;
    const hoursPts = Math.max(0, Math.min(70, s.hours / 8 * 70));
    const qualityPts = s.quality != null ? (s.quality / 5 * 30) : 15;
    return Math.round(hoursPts + qualityPts);
  }
  const SLEEP_RING_C = 2 * Math.PI * 42;
  const sleepScoreFillEl = document.getElementById('sleepScoreFill');
  if (sleepScoreFillEl) {
    sleepScoreFillEl.setAttribute('stroke-dasharray', SLEEP_RING_C);
    sleepScoreFillEl.setAttribute('stroke-dashoffset', SLEEP_RING_C);
  }
  function renderSleepScoreRing(score) {
    if (!sleepScoreFillEl) return;
    const numEl = document.getElementById('sleepScoreNum');
    const bandEl = document.getElementById('sleepScoreBand');
    if (score == null) {
      sleepScoreFillEl.setAttribute('stroke-dashoffset', SLEEP_RING_C);
      sleepScoreFillEl.style.stroke = 'rgba(255,255,255,0.16)';
      numEl.textContent = '—';
      bandEl.textContent = 'SCORE';
      return;
    }
    const band = sleepScoreBand(score);
    sleepScoreFillEl.setAttribute('stroke-dashoffset', SLEEP_RING_C * (1 - score / 100));
    sleepScoreFillEl.style.stroke = band.color;
    numEl.textContent = String(score);
    bandEl.textContent = band.label.toUpperCase();
  }

  // ---------- Sleep Hours timeline ----------
  const SLEEP_STAGE_LABELS = { awake: 'Awake', light: 'Light', deep: 'Deep', rem: 'REM' };
  function formatTime12(hhmm) {
    const [h, m] = hhmm.split(':').map(Number);
    const ampm = h >= 12 ? 'pm' : 'am';
    let hh = h % 12; if (hh === 0) hh = 12;
    return hh + ':' + pad2(m) + ampm;
  }
  // Real Garmin stage data (s.stages: [{stage, durMin}, ...]) renders as
  // proper Awake/Light/Deep/REM segments; without it (every night today)
  // this collapses to one plain "asleep" span rather than inventing a
  // stage breakdown we have no way to actually know.
  function renderSleepTimeline(s) {
    const wrap = document.getElementById('sleepTimeline');
    const startEl = document.getElementById('sleepTimelineStart');
    const endEl = document.getElementById('sleepTimelineEnd');
    if (!wrap) return;
    wrap.innerHTML = '';
    if (!s.bedTime || !s.wakeTime) {
      startEl.textContent = '—';
      endEl.textContent = '—';
      return;
    }
    startEl.textContent = formatTime12(s.bedTime);
    endEl.textContent = formatTime12(s.wakeTime);

    if (Array.isArray(s.stages) && s.stages.length) {
      const total = s.stages.reduce((sum, st) => sum + (st.durMin || 0), 0) || 1;
      s.stages.forEach(st => {
        const seg = document.createElement('div');
        seg.className = 'sleep-timeline-seg';
        seg.dataset.stage = st.stage;
        seg.style.width = (st.durMin / total * 100) + '%';
        seg.title = (SLEEP_STAGE_LABELS[st.stage] || st.stage) + ' · ' + st.durMin + 'm';
        wrap.appendChild(seg);
      });
    } else {
      const seg = document.createElement('div');
      seg.className = 'sleep-timeline-seg';
      seg.dataset.stage = 'asleep';
      seg.style.width = '100%';
      seg.title = 'Asleep';
      wrap.appendChild(seg);
    }
  }

  function renderSleep() {
    const s = getSleep();
    document.getElementById('sleepBedTime').value = s.bedTime || '';
    document.getElementById('sleepWakeTime').value = s.wakeTime || '';

    const hoursEl = document.getElementById('sleepHoursNum');
    const labelEl = document.getElementById('sleepHoursLabel');
    hoursEl.textContent = s.hours != null ? formatSleepHours(s.hours) : '—';
    labelEl.textContent = s.hours != null ? (SLEEP_QUALITY_LABELS[s.quality] || 'logged') : 'no data yet';

    const sourceTag = document.getElementById('sleepSourceTag');
    const isLive = s.source === 'garmin';
    sourceTag.classList.toggle('sleep-source-live', isLive);
    document.getElementById('sleepSourceLabel').textContent = isLive ? 'Live from Garmin' : 'Manual';

    document.querySelectorAll('#sleepQualityControl .wk-seg-btn').forEach(btn => {
      btn.classList.toggle('active', Number(btn.dataset.q) === s.quality);
    });

    renderSleepScoreRing(computeSleepScore(s));
    renderSleepTimeline(s);
    renderSleepChart();
  }
  // Minimal 7-night trend — bar height is hours slept that active date,
  // scaled against whichever is bigger: an 8h reference or the tallest
  // night in the window (so one very long night doesn't flatten the
  // rest). A day with no sleep:<date> entry at all renders as a faint
  // empty stub rather than a 0-height gap.
  const SLEEP_CHART_DOW = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  function renderSleepChart() {
    const wrap = document.getElementById('sleepChartBars');
    if (!wrap) return;
    const todayActive = getActiveDateString();
    const [y, m, d] = todayActive.split('-').map(Number);
    const days = [];
    for (let i = 6; i >= 0; i--) days.push(dateToKey(new Date(y, m - 1, d - i)));

    const hoursArr = days.map(k => {
      const raw = storeGet('sleep:' + k);
      return (raw && typeof raw === 'object' && !Array.isArray(raw) && raw.hours != null) ? raw.hours : 0;
    });
    const max = Math.max(8, ...hoursArr);

    wrap.innerHTML = '';
    days.forEach((k, i) => {
      const hours = hoursArr[i];
      const isToday = k === todayActive;
      const pct = hours > 0 ? Math.max(6, Math.round(hours / max * 100)) : 6;

      const barWrap = document.createElement('div');
      barWrap.className = 'sleep-chart-bar-wrap';
      barWrap.title = hours > 0 ? (formatSleepHours(hours) + ' · ' + k) : 'No data logged';

      const bar = document.createElement('div');
      bar.className = 'sleep-chart-bar' + (isToday ? ' is-today' : '') + (hours > 0 ? '' : ' is-empty');
      bar.style.height = pct + '%';
      barWrap.appendChild(bar);

      const label = document.createElement('div');
      label.className = 'sleep-chart-day' + (isToday ? ' is-today' : '');
      label.textContent = SLEEP_CHART_DOW[new Date(k + 'T00:00:00').getDay()];
      barWrap.appendChild(label);

      wrap.appendChild(barWrap);
    });
  }

  function buildNightRoutineRow(item, idx) {
    const li = document.createElement('li');
    li.className = 'gm-row nr-row';
    if (item.done) li.classList.add('gm-row-done');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'gm-check';
    cb.checked = !!item.done;
    cb.addEventListener('change', () => {
      const list = getNightRoutine();
      if (!list[idx]) return;
      list[idx].done = cb.checked;
      setNightRoutine(list);
      renderNightRoutine();
    });
    li.appendChild(cb);

    const text = document.createElement('span');
    text.className = 'nr-text';
    text.textContent = item.text;
    li.appendChild(text);
    makeInlineEdit(text, idx, getNightRoutine, setNightRoutine, renderNightRoutine);

    return li;
  }
  function renderNightRoutine() {
    const list = getNightRoutine();
    const ul = document.getElementById('nightRoutineList');
    if (!ul) return;
    ul.innerHTML = '';
    list.forEach((item, i) => ul.appendChild(buildNightRoutineRow(item, i)));

    const done = list.filter(i => i.done).length;
    document.getElementById('nrProgressNum').textContent = done;
    document.getElementById('nrProgressTotal').textContent = '/ ' + list.length;
    document.getElementById('nrProgressLabel').textContent =
      done === list.length ? 'all set for tomorrow' : (list.length - done) + ' left';
    document.getElementById('nrCard').classList.toggle('nr-all-done', done === list.length);
  }

  ['sleepBedTime', 'sleepWakeTime'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      const s = getSleep();
      s.bedTime = document.getElementById('sleepBedTime').value || null;
      s.wakeTime = document.getElementById('sleepWakeTime').value || null;
      s.hours = computeSleepHours(s.bedTime, s.wakeTime);
      s.source = 'manual';
      setSleep(s);
      renderSleep();
    });
  });
  document.getElementById('sleepQualityControl').addEventListener('click', (e) => {
    const btn = e.target.closest('.wk-seg-btn');
    if (!btn) return;
    const s = getSleep();
    const q = Number(btn.dataset.q);
    s.quality = (s.quality === q) ? null : q;
    s.source = s.source || 'manual';
    setSleep(s);
    renderSleep();
  });

  window.NightSleep = {
    renderNightRoutine: renderNightRoutine,
    renderSleep: renderSleep
  };

  renderNightRoutine();
  renderSleep();
})();
