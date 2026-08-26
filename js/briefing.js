// =============================================================
// Morning briefing — one paragraph, generated once per active day,
// cached in briefing:<date>, synced via its own initCloudSync channel
// so a briefing generated on one device shows up on another without a
// second paid API call.
// =============================================================
(function () {
  'use strict';

  const Dash = window.Dash;
  const getActiveDateString = Dash.getActiveDateString;
  const dateToKey = Dash.dateToKey;

  function storeGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function briefingKey() { return 'briefing:' + getActiveDateString(); }

  // ---------- payload assembly, from data already loaded on the page ----------
  function weekdayName() {
    return ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'][new Date().getDay()];
  }
  function buildPayload() {
    const goals = storeGet('goals:' + getActiveDateString()) || [];
    const sleep = storeGet('sleep:' + getActiveDateString()) || {};
    const runs = storeGet('run:runs') || [];
    const goal = storeGet('run:goal') || {};

    const sortedRuns = runs.filter(function (r) { return r && r.date; })
      .slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    const lastRun = sortedRuns[0]
      ? { date: sortedRuns[0].date, km: sortedRuns[0].distanceKm, type: sortedRuns[0].type }
      : null;

    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 7);
    const cutoffKey = dateToKey(cutoff);
    const last7DaysKm = runs.reduce(function (sum, r) {
      return (r && r.date && r.date >= cutoffKey) ? sum + (Number(r.distanceKm) || 0) : sum;
    }, 0);

    let daysToRace = null;
    if (goal.raceDate) {
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const race = new Date(goal.raceDate + 'T00:00:00');
      daysToRace = Math.round((race - today) / 86400000);
    }

    const weatherEl = document.getElementById('heroWeather');

    return {
      weekday: weekdayName(),
      tasksPlanned: goals.length,
      taskTitles: goals.slice(0, 5).map(function (g) { return g && g.text; }).filter(Boolean),
      sleepHours: sleep.hours || null,
      sleepQuality: sleep.quality || null,
      lastRun: lastRun,
      last7DaysKm: Math.round(last7DaysKm * 10) / 10,
      daysToRace: daysToRace,
      raceName: goal.raceName || null,
      weather: weatherEl ? weatherEl.textContent : null
    };
  }

  // ---------- render ----------
  function ensureShell() {
    const el = document.getElementById('briefCard');
    if (!el || el.dataset.built) return el;
    el.dataset.built = '1';
    el.innerHTML =
      '<div class="brief-head">' +
        '<span class="brief-eyebrow">Briefing</span>' +
        '<button type="button" class="brief-toggle" id="briefToggle">Hide</button>' +
      '</div>' +
      '<p class="brief-body" id="briefBody"></p>';
    document.getElementById('briefToggle').addEventListener('click', function () {
      const collapsed = el.classList.toggle('is-collapsed');
      this.textContent = collapsed ? 'Read' : 'Hide';
    });
    return el;
  }
  function applyTimeCollapse(el) {
    const btn = document.getElementById('briefToggle');
    if (new Date().getHours() >= 12) {
      el.classList.add('is-collapsed');
      if (btn) btn.textContent = 'Read';
    }
  }
  function render(text, failed) {
    const el = ensureShell();
    if (!el) return;
    const body = document.getElementById('briefBody');
    if (failed) {
      body.textContent = 'Briefing unavailable right now. Everything below still works.';
      body.style.color = 'var(--text-tertiary)';
    } else {
      // textContent, not innerHTML — the API response is prose we never
      // parse as markup, so there is no sink to escape into in the
      // first place.
      body.style.color = '';
      body.textContent = text;
    }
    applyTimeCollapse(el);
  }

  // ---------- fetch ----------
  function requestBriefing() {
    fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'briefing', input: JSON.stringify(buildPayload()) })
    })
      .then(function (res) { if (!res.ok) throw new Error('briefing request failed'); return res.json(); })
      .then(function (data) {
        if (!data || typeof data.text !== 'string' || !data.text.trim()) throw new Error('bad response');
        const text = data.text.trim();
        try {
          localStorage.setItem(briefingKey(), JSON.stringify({ text: text, generatedAt: Date.now() }));
        } catch (e) {}
        render(text, false);
      })
      .catch(function () { render('', true); });
  }

  function cachedText() {
    const c = storeGet(briefingKey());
    return (c && typeof c.text === 'string' && c.text.trim()) ? c.text : null;
  }

  function init() {
    if (!document.getElementById('briefCard')) return;
    const cached = cachedText();
    if (cached) { render(cached, false); return; }

    // Give cross-device sync a moment to pull today's briefing before
    // paying for a fresh one — onApplied fires the instant remote data
    // lands; the timeout is only a ceiling for "nobody has generated
    // one yet today".
    let settled = false;
    function useCacheIfAny() {
      if (settled) return false;
      const c = cachedText();
      if (c) { settled = true; render(c, false); return true; }
      return false;
    }
    if (typeof window.initCloudSync === 'function') {
      window.initCloudSync({
        appKey: 'briefing',
        syncedPrefixes: ['briefing:'],
        onApplied: useCacheIfAny
      });
    }
    setTimeout(function () {
      if (!useCacheIfAny() && !settled) { settled = true; requestBriefing(); }
    }, 1200);
  }

  // A briefing that lands after initial render (this device generated
  // nothing, another device's push arrived a moment later) still needs
  // to reach the DOM.
  window.addEventListener('storage', function (e) {
    if (e.key === briefingKey()) {
      const c = cachedText();
      if (c) render(c, false);
    }
  });

  init();
})();
