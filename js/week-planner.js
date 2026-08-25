document.addEventListener('DOMContentLoaded', function () {
  (function () {
    'use strict';

    const WK_PREFIX = 'weekplan:';
    const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    // No per-split 'sub'/'fallback' text here anymore — push/pull/legs/full
    // exercise descriptions are moving to the Hevy API integration. Run's
    // only description is the dated Garmin sentence built in
    // formatGarminRunDescription(), or nothing.
    const MUSCLE_CONFIG = {
      push: { view: 'front', regions: ['shoulders', 'chest', 'arms'], title: 'Push day' },
      pull: { view: 'back', regions: ['back', 'biceps'], title: 'Pull day' },
      legs: { view: 'front', regions: ['quads', 'calves'], accent: 'success', title: 'Legs day' },
      full: { composite: ['push', 'pull', 'legs'], accent: 'success', title: 'Full body day' },
      run:  { view: 'front', regions: ['quads', 'calves'], accent: 'run', title: 'Run day' }
    };
    ['push', 'pull', 'legs'].forEach(function (k) {
      if (!MUSCLE_CONFIG[k].accent) MUSCLE_CONFIG[k].accent = 'success';
    });
    // Most splits map to a single body view (front or back); 'full' is a
    // composite of push+pull+legs and spans both — this resolves either
    // shape to a flat [{view, regions}, ...] list so the lighting/view
    // logic below doesn't need to special-case composites itself.
    function getViewRegionPairs(splitKey) {
      const cfg = MUSCLE_CONFIG[splitKey];
      if (cfg.composite) {
        return cfg.composite.map(function (k) {
          return { view: MUSCLE_CONFIG[k].view, regions: MUSCLE_CONFIG[k].regions };
        });
      }
      return [{ view: cfg.view, regions: cfg.regions }];
    }

    // A day's plan value used to be a single split string. It's now an
    // array so a day can be e.g. ['push', 'run']. This normalizes either
    // shape (including old data already saved as a bare string) to an array.
    function normalizeSplits(v) {
      if (!v) return [];
      return Array.isArray(v) ? v : [v];
    }
    function hexToRgba(hex, alpha) {
      const h = hex.replace('#', '');
      const r = parseInt(h.substring(0, 2), 16), g = parseInt(h.substring(2, 4), 16), b = parseInt(h.substring(4, 6), 16);
      return 'rgba(' + r + ',' + g + ',' + b + ',' + alpha + ')';
    }
    const SPLIT_TAG_COLORS = { push: '#087CA3', pull: '#20A5A0', legs: '#B98AE0', full: '#F2C063', run: '#A83FAF' };
    // Tag text under each day in the strip.
    const SPLIT_TAG_LABELS = { push: 'Push', pull: 'Pull', legs: 'Legs', full: 'Full', run: 'Run', rest: 'Rest' };
    function splitTagLabel(s) { return SPLIT_TAG_LABELS[s] || (s.charAt(0).toUpperCase() + s.slice(1)); }
    // Canonical display order for a combo day — matches topbar.js's
    // SPLIT_ORDER and gym.html's SPLIT_PILL_ORDER exactly, so a day like
    // ['run','legs'] (stored in whatever order it was toggled) always
    // reads the same everywhere: the topbar badge, this card's own detail
    // title, and the 7-day strip's tag. Sort any splits array through this
    // before displaying — never show raw insertion/toggle order.
    const SPLIT_DISPLAY_ORDER = ['push', 'pull', 'legs', 'full', 'run', 'rest'];
    function orderedSplits(arr) { return SPLIT_DISPLAY_ORDER.filter(function (s) { return arr.indexOf(s) !== -1; }); }

    function pad(n) { return n < 10 ? '0' + n : '' + n; }
    function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
    function parseYMD(s) { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
    function mondayOf(date) {
      const d = new Date(date);
      const day = d.getDay();
      d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
      d.setHours(0, 0, 0, 0);
      return d;
    }
    function isoWeekKey(date) {
      const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
      const dayNum = d.getUTCDay() || 7;
      d.setUTCDate(d.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
      return d.getUTCFullYear() + '-W' + pad(weekNo);
    }

    const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const today = new Date();
    const todayKey = ymd(today);

    let weekOffset = 0;
    let monday, weekDates, STORE_KEY;
    let activeDate = todayKey;

    function computeWeekState() {
      monday = mondayOf(today);
      monday.setDate(monday.getDate() + weekOffset * 7);
      weekDates = [];
      for (let i = 0; i < 7; i++) {
        const d = new Date(monday);
        d.setDate(monday.getDate() + i);
        weekDates.push(ymd(d));
      }
      STORE_KEY = WK_PREFIX + isoWeekKey(monday);
    }
    computeWeekState();

    function loadPlan() {
      try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch (e) { return {}; }
    }
    function savePlan(plan) {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(plan)); } catch (e) {}
    }
    function fmtKm(km) {
      if (km == null || !isFinite(km) || km <= 0) return null;
      const r = Math.round(km * 10) / 10;
      return (r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)) + ' km';
    }
    function fmtPace(secPerKm) {
      if (!secPerKm || !isFinite(secPerKm)) return null;
      const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
      return m + ':' + (s < 10 ? '0' + s : s) + '/km';
    }
    function ordinalSuffix(n) {
      const v = n % 100;
      if (v >= 11 && v <= 13) return 'th';
      switch (n % 10) { case 1: return 'st'; case 2: return 'nd'; case 3: return 'rd'; default: return 'th'; }
    }
    // The only "description" shown for a Run day — every actual Garmin-
    // synced run on that exact date (Garmin often logs a warmup/main/
    // cooldown as separate same-day activities), in one plain sentence
    // (e.g. "Monday 17th, 10km run" or "Wednesday 19th, 8.5km + 2.2km +
    // 6km + 2.3km runs"). No plan, no fallback text: null means nothing
    // renders.
    function formatGarminRunDescription(dateKey) {
      try {
        const runsRaw = localStorage.getItem('run:runs');
        if (!runsRaw) return null;
        const list = JSON.parse(runsRaw);
        if (!Array.isArray(list)) return null;
        const logged = list.filter(function (r) { return r.date === dateKey && r.distanceKm > 0; })
          .sort(function (a, b) { return (a.time || '00:00:00').localeCompare(b.time || '00:00:00'); });
        if (!logged.length) return null;
        const d = parseYMD(dateKey);
        const weekday = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()];
        const day = d.getDate();
        const kmStrs = logged.map(function (r) {
          const km = Math.round(r.distanceKm * 10) / 10;
          return (km % 1 === 0 ? km.toFixed(0) : km.toFixed(1)) + 'km';
        });
        const noun = logged.length > 1 ? 'runs' : 'run';
        return weekday + ' ' + day + ordinalSuffix(day) + ', ' + kmStrs.join(' + ') + ' ' + noun;
      } catch (e) { return null; }
    }
    function loadDoneDays() {
      try { return JSON.parse(localStorage.getItem('po_coach_workout_done')) || {}; } catch (e) { return {}; }
    }
    // Same key + shape gym.html's own "Mark workout done" button already
    // writes ({ [dateKey]: isoTimestampString }, presence = done) — this
    // is the ONE completion store goals-data.js's Evidence.fitness()
    // reads for the "Train consistently" habit, so writing here needs no
    // separate sync path or change to that math, just the same key.
    function saveDoneDays(d) {
      try { localStorage.setItem('po_coach_workout_done', JSON.stringify(d)); } catch (e) {}
    }

    const stripEl        = document.getElementById('wkStrip');
    const prevWeekBtn      = document.getElementById('wkPrevWeek');
    const nextWeekBtn       = document.getElementById('wkNextWeek');
    const weekLabelEl        = document.getElementById('wkWeekLabel');
    const segEl           = document.getElementById('wkSegControl');
    const completeBtn      = document.getElementById('wkCompleteBtn');
    const frontSvg         = document.getElementById('wkChartFront');
    const backSvg           = document.getElementById('wkChartBack');
    const chartTitleEl       = document.getElementById('wkChartTitle');
    const chartExEl           = document.getElementById('wkChartEx');
    const chartRestEl         = document.getElementById('wkChartRest');
    const chartBodyWrap       = document.getElementById('wkChartBodyWrap');
    if (!stripEl) return;

    function renderStrip() {
      const plan = loadPlan();
      const done = loadDoneDays();
      stripEl.innerHTML = '';
      weekDates.forEach(function (dateKey, i) {
        const d = parseYMD(dateKey);
        const split = plan[dateKey];
        const card = document.createElement('div');
        card.className = 'wk-day'
          + (dateKey === todayKey ? ' is-today' : '')
          + (dateKey === activeDate ? ' is-active' : '');
        card.dataset.date = dateKey;

        const nameEl = document.createElement('div');
        nameEl.className = 'wk-day-name';
        nameEl.textContent = DAY_NAMES[i];

        const numEl = document.createElement('div');
        numEl.className = 'wk-day-num';
        numEl.textContent = d.getDate();

        const tagEl = document.createElement('div');
        tagEl.className = 'wk-day-tag';
        const splitArr = normalizeSplits(split);
        if (splitArr.length === 1) {
          tagEl.dataset.split = splitArr[0];
          tagEl.textContent = splitTagLabel(splitArr[0]);
        } else if (splitArr.length > 1) {
          const combo = orderedSplits(splitArr);
          tagEl.classList.add('wk-day-tag-combo');
          tagEl.textContent = combo.map(splitTagLabel).join('+');
          const colors = combo.map(function (s) { return SPLIT_TAG_COLORS[s] || '#687580'; });
          tagEl.style.background = 'linear-gradient(90deg, ' + colors.map(function (c) { return hexToRgba(c, 0.20); }).join(', ') + ')';
          tagEl.style.color = colors[0];
        } else {
          tagEl.textContent = '—';
        }
        if (done[dateKey]) {
          const chk = document.createElement('span');
          chk.className = 'wk-day-done';
          chk.textContent = '✓';
          tagEl.appendChild(chk);
        }

        card.append(nameEl, numEl, tagEl);
        card.addEventListener('click', function () {
          activeDate = dateKey;
          renderStrip();
          renderSeg();
          renderChart();
        });
        stripEl.appendChild(card);
      });
    }

    function renderSeg() {
      const plan = loadPlan();
      const current = normalizeSplits(plan[activeDate]);
      segEl.querySelectorAll('.wk-seg-btn').forEach(function (btn) {
        btn.classList.toggle('active', current.indexOf(btn.dataset.split) !== -1);
      });
    }

    function renderChart() {
      const plan = loadPlan();
      const splits = normalizeSplits(plan[activeDate]);

      if (!splits.length) {
        chartBodyWrap.style.display = 'none';
        chartRestEl.style.display = 'block';
        chartRestEl.textContent = "Pick Push, Pull, Legs, Full, or Run to see the day's focus.";
        completeBtn.style.display = 'none';
        return;
      }
      if (splits.indexOf('rest') !== -1) {
        chartBodyWrap.style.display = 'none';
        chartRestEl.style.display = 'block';
        chartRestEl.textContent = 'Rest day — recovery in progress.';
        completeBtn.style.display = 'none';
        return;
      }

      chartRestEl.style.display = 'none';
      chartBodyWrap.style.display = 'flex';
      renderCompleteBtn();

      const allPairs = splits.reduce(function (acc, s) { return acc.concat(getViewRegionPairs(s)); }, []);
      const needFront = allPairs.some(function (p) { return p.view === 'front'; });
      const needBack  = allPairs.some(function (p) { return p.view === 'back'; });
      frontSvg.style.display = needFront ? 'block' : 'none';
      backSvg.style.display  = needBack  ? 'block' : 'none';

      [frontSvg, backSvg].forEach(function (svg) {
        svg.querySelectorAll('.wk-muscle').forEach(function (el) {
          el.classList.remove('is-lit', 'is-lit-run');
        });
      });
      // Light lift-split regions first (teal), then run's regions (magenta)
      // for anything a lift split hasn't already claimed — so a combined
      // Legs + Run day doesn't fight itself over quads/calves.
      const claimed = {};
      splits.filter(function (s) { return s !== 'run'; }).forEach(function (s) {
        getViewRegionPairs(s).forEach(function (pair) {
          const svg = pair.view === 'front' ? frontSvg : backSvg;
          pair.regions.forEach(function (region) {
            svg.querySelectorAll('[data-region="' + region + '"]').forEach(function (el) {
              el.classList.add('is-lit');
            });
            claimed[pair.view + ':' + region] = true;
          });
        });
      });
      if (splits.indexOf('run') !== -1) {
        getViewRegionPairs('run').forEach(function (pair) {
          const svg = pair.view === 'front' ? frontSvg : backSvg;
          pair.regions.forEach(function (region) {
            if (claimed[pair.view + ':' + region]) return;
            svg.querySelectorAll('[data-region="' + region + '"]').forEach(function (el) {
              el.classList.add('is-lit-run');
            });
          });
        });
      }

      const ordered = orderedSplits(splits);
      chartTitleEl.textContent = ordered.map(function (s) { return MUSCLE_CONFIG[s].title.replace(/ day$/i, ''); }).join(' + ') + ' Day';

      // No per-split exercise description for push/pull/legs/full anymore —
      // that's moving to the Hevy API integration. Run keeps its own
      // dated Garmin sentence, which has nothing to do with Hevy.
      const runDesc = ordered.indexOf('run') !== -1 ? formatGarminRunDescription(activeDate) : null;
      chartExEl.textContent = runDesc || '';
      chartExEl.style.display = runDesc ? '' : 'none';
    }

    // A day only counts toward "Train consistently" once this is
    // clicked — selecting a split just plans the day, same distinction
    // the checkmark on the day-strip cards already draws.
    function renderCompleteBtn() {
      completeBtn.style.display = '';
      const isDone = !!loadDoneDays()[activeDate];
      completeBtn.classList.toggle('is-done', isDone);
      completeBtn.textContent = isDone ? '✓ Completed' : 'Mark complete';
    }
    completeBtn.addEventListener('click', function () {
      const doneDays = loadDoneDays();
      if (doneDays[activeDate]) delete doneDays[activeDate];
      else doneDays[activeDate] = new Date().toISOString();
      saveDoneDays(doneDays);
      renderCompleteBtn();
      renderStrip();
    });

    function renderWeekLabel() {
      const start = parseYMD(weekDates[0]);
      const end = parseYMD(weekDates[6]);
      const startStr = MONTH_NAMES[start.getMonth()] + ' ' + start.getDate();
      const endStr = (end.getMonth() === start.getMonth())
        ? String(end.getDate())
        : MONTH_NAMES[end.getMonth()] + ' ' + end.getDate();
      weekLabelEl.textContent = startStr + ' – ' + endStr + (weekOffset === 0 ? ' · this week' : '');
      weekLabelEl.classList.toggle('is-current', weekOffset === 0);
    }

    function renderAll() {
      renderWeekLabel();
      renderStrip();
      renderSeg();
      renderChart();
      if (typeof window.refreshTodaySplitBadge === 'function') window.refreshTodaySplitBadge();
    }

    function goToWeek(offset) {
      weekOffset = offset;
      computeWeekState();
      activeDate = (weekOffset === 0) ? todayKey : weekDates[0];
      renderAll();
    }

    prevWeekBtn.addEventListener('click', function () { goToWeek(weekOffset - 1); });
    nextWeekBtn.addEventListener('click', function () { goToWeek(weekOffset + 1); });
    weekLabelEl.addEventListener('click', function () {
      if (weekOffset !== 0) goToWeek(0);
    });

    segEl.addEventListener('click', function (e) {
      const btn = e.target.closest('.wk-seg-btn');
      if (!btn) return;
      const plan = loadPlan();
      const split = btn.dataset.split;
      let cur = normalizeSplits(plan[activeDate]);
      if (split === 'rest') {
        // Rest is exclusive — picking it clears anything else, and it's
        // the only thing a second click on it can toggle off.
        cur = cur.indexOf('rest') !== -1 ? [] : ['rest'];
      } else {
        cur = cur.filter(function (s) { return s !== 'rest'; });
        const idx = cur.indexOf(split);
        if (idx !== -1) cur.splice(idx, 1); else cur.push(split);
      }
      if (cur.length) plan[activeDate] = cur; else delete plan[activeDate];
      savePlan(plan);
      // A completion mark only makes sense for a planned workout — if the
      // split changes to rest or gets cleared entirely, any earlier "Mark
      // complete" for this date is now stale and would keep inflating the
      // "Train consistently" count for a day that no longer has a workout.
      if (!cur.length || cur.indexOf('rest') !== -1) {
        const doneDays = loadDoneDays();
        if (doneDays[activeDate]) {
          delete doneDays[activeDate];
          saveDoneDays(doneDays);
        }
      }
      renderStrip();
      renderSeg();
      renderChart();
      if (typeof window.refreshTodaySplitBadge === 'function') window.refreshTodaySplitBadge();
    });

    // Pointer-drag-to-scroll for desktop/mouse users (touch already scrolls natively).
    (function enableDragScroll() {
      let isDown = false, startX = 0, startScroll = 0, moved = false;
      stripEl.addEventListener('mousedown', function (e) {
        isDown = true; moved = false;
        startX = e.pageX; startScroll = stripEl.scrollLeft;
        stripEl.classList.add('is-dragging');
      });
      window.addEventListener('mouseup', function () {
        isDown = false;
        stripEl.classList.remove('is-dragging');
      });
      window.addEventListener('mousemove', function (e) {
        if (!isDown) return;
        const dx = e.pageX - startX;
        if (Math.abs(dx) > 4) moved = true;
        stripEl.scrollLeft = startScroll - dx;
      });
      stripEl.addEventListener('click', function (e) {
        if (moved) { e.stopPropagation(); moved = false; }
      }, true);
    })();

    renderAll();
    const activeCard = stripEl.querySelector('.wk-day.is-active');
    if (activeCard) {
      // Center the active card horizontally within the strip by setting
      // scrollLeft directly, rather than activeCard.scrollIntoView(...).
      // scrollIntoView's "nearest" block option is meant to leave the
      // vertical scroll alone, but with a sticky top bar in the mix
      // mobile Safari can still nudge the page down so the card's top
      // ends up hidden behind it — this sidesteps that entirely by never
      // touching vertical scroll at all.
      stripEl.scrollLeft = activeCard.offsetLeft - (stripEl.clientWidth - activeCard.offsetWidth) / 2;
    }

    // The strip reads run:runs/run:weekPlan directly off localStorage
    // (see loadRunPlanParts above). Those keys sync under a different
    // appKey ('running', registered by the Running Overview module below),
    // so this only learns about a Garmin sync via the same synthetic
    // 'storage' event the goals module already dispatches on its own
    // updates — not a native browser event, since initCloudSync writes
    // straight to localStorage without going through the patched setItem.
    window.addEventListener('storage', renderAll);

    if (typeof initCloudSync === 'function') {
      initCloudSync({
        appKey: 'weekplan',
        syncedPrefixes: [WK_PREFIX],
        onApplied: renderAll
      });
      // Same appKey + syncedKeys goals.html already registers to read
      // gym.html's workout completion — gym.html pushes po_coach_* keys
      // through its own bespoke sync, this just pulls (and, now that
      // the Mark Complete button above writes po_coach_workout_done
      // locally too, pushes) the same Supabase row via the standard
      // sync.js path, so a completion marked from either page reaches
      // both without a second sync mechanism.
      initCloudSync({
        appKey: 'po-coach',
        syncedKeys: ['po_coach_v1', 'po_coach_workout_done', 'po_coach_weights', 'po_coach_photos'],
        onApplied: renderAll
      });
    }
  })();
});
