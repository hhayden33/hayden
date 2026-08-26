// =============================================================
// Race countdown tile — reads run:goal and run:runs, read-only.
// Mounted as the third element in .status-row, after the North Star
// mini card.
// =============================================================
(function () {
  'use strict';

  function load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return (v == null) ? fallback : v; }
    catch (e) { return fallback; }
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function dateKeyOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function daysBetween(fromKey, toKey) {
    const a = new Date(fromKey + 'T00:00:00'), b = new Date(toKey + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }

  // Derived from days remaining, not weeks elapsed, so it stays correct
  // if the plan start slipped.
  function trainingBlock(daysLeft) {
    if (daysLeft <= 0) return 'Race day';
    if (daysLeft <= 14) return 'Taper';
    if (daysLeft <= 42) return 'Peak block';
    if (daysLeft <= 84) return 'Build block';
    return 'Base block';
  }

  function longestRunSince(runs, sinceKey) {
    return runs.filter(function (r) { return r && r.date && r.date >= sinceKey; })
      .reduce(function (m, r) { return Math.max(m, Number(r.distanceKm) || 0); }, 0);
  }

  function render() {
    const el = document.getElementById('cdTile');
    if (!el) return;
    const goal = load('run:goal', null);
    const runs = load('run:runs', []);

    if (!goal || !goal.raceDate) {
      el.innerHTML = '<div class="cd-eyebrow"></div><div class="cd-num cd-num-empty"></div>';
      el.querySelector('.cd-eyebrow').textContent = 'Race Countdown';
      el.querySelector('.cd-num').textContent = 'Set a race in Running →';
      el.classList.remove('cd-near');
      return;
    }

    const todayKey = dateKeyOf(new Date());
    const daysLeft = daysBetween(todayKey, goal.raceDate);
    // raceName is user-entered text from running.html — always inserted
    // via textContent below, never concatenated into the innerHTML string.
    const raceName = goal.raceName || 'Race';

    if (daysLeft < 0) {
      el.innerHTML =
        '<div class="cd-eyebrow"></div>' +
        '<div class="cd-num">✓<em>Done</em></div>' +
        '<div class="cd-sub"></div>';
      el.querySelector('.cd-eyebrow').textContent = raceName;
      el.querySelector('.cd-sub').textContent = 'Done ' + Math.abs(daysLeft) + ' days ago';
      el.classList.remove('cd-near');
      return;
    }

    const block = trainingBlock(daysLeft);
    let subText = '';
    if (goal.planStartDate && goal.planTotalWeeks) {
      const total = goal.planTotalWeeks;
      const wk = Math.max(1, Math.min(total, Math.floor(daysBetween(goal.planStartDate, todayKey) / 7) + 1));
      const longest = longestRunSince(runs, goal.planStartDate);
      subText = 'Week ' + wk + ' / ' + total + (longest > 0 ? ' · ' + (Math.round(longest * 10) / 10) + ' km longest' : '');
    }

    el.innerHTML =
      '<div class="cd-eyebrow"></div>' +
      '<div class="cd-num">' + daysLeft + '<em>days</em></div>' +
      '<div class="cd-block"></div>' +
      '<div class="cd-sub"></div>';
    el.querySelector('.cd-eyebrow').textContent = raceName;
    el.querySelector('.cd-block').textContent = block;
    el.querySelector('.cd-sub').textContent = subText;

    el.classList.toggle('cd-near', daysLeft <= 14);
  }

  render();
  window.addEventListener('storage', render);
  setInterval(render, 60 * 60 * 1000); // hourly, so the number ticks over without a reload
})();
