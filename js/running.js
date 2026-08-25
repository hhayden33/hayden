// =============================================================
// RUNNING OVERVIEW — reads the same run: keys running.html owns
// (run:runs, run:pbs, run:goal, run:garminSnapshot), synced via the
// same 'running' Supabase row running.html already syncs to. This
// page never writes those keys, only displays a summary + links out
// to running.html for detail/editing.
// =============================================================
(function () {
  'use strict';

  function load(key, fallback) {
    try { const v = JSON.parse(localStorage.getItem(key)); return (v == null) ? fallback : v; }
    catch (e) { return fallback; }
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function dateKeyOf(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function mondayOf(d) {
    const date = new Date(d);
    const day = (date.getDay() + 6) % 7; // 0 = Monday
    date.setDate(date.getDate() - day);
    date.setHours(0, 0, 0, 0);
    return date;
  }
  function daysBetween(fromKey, toKey) {
    const a = new Date(fromKey + 'T00:00:00'), b = new Date(toKey + 'T00:00:00');
    return Math.round((b - a) / 86400000);
  }
  function fmtKm(km) {
    if (km == null || !isFinite(km) || km <= 0) return null;
    const r = Math.round(km * 10) / 10;
    return (r % 1 === 0 ? r.toFixed(0) : r.toFixed(1)) + ' km';
  }
  function fmtPace(secPerKm) {
    if (!secPerKm || !isFinite(secPerKm)) return null;
    const m = Math.floor(secPerKm / 60), s = Math.round(secPerKm % 60);
    return m + ':' + pad2(s) + '/km';
  }

  function runs() { return load('run:runs', []); }

  // ---------- 12-week mileage chart (same bar-chart + tooltip pattern as
  // running.html's Training Analytics, just a longer window) ----------
  function fmtWeekRange(wkStart) {
    const wkEnd = new Date(wkStart); wkEnd.setDate(wkEnd.getDate() + 6);
    const opts = { day: 'numeric', month: 'short' };
    return wkStart.toLocaleDateString('en-AU', opts) + ' – ' + wkEnd.toLocaleDateString('en-AU', opts);
  }
  function weeklyMileageSeries12() {
    const monday = mondayOf(new Date());
    const allRuns = runs();
    const out = [];
    for (let i = 11; i >= 0; i--) {
      const wkStart = new Date(monday); wkStart.setDate(wkStart.getDate() - 7 * i);
      const wkEnd = new Date(wkStart); wkEnd.setDate(wkEnd.getDate() + 6);
      const startKey = dateKeyOf(wkStart), endKey = dateKeyOf(wkEnd);
      const total = allRuns.filter(function (r) { return r.date >= startKey && r.date <= endKey; })
        .reduce(function (s, r) { return s + (r.distanceKm || 0); }, 0);
      out.push({ value: total, sub: fmtWeekRange(wkStart) });
    }
    return out;
  }
  function wireMileageChartHover() {
    const wrap = document.getElementById('roChartWrap');
    const svg = wrap.querySelector('svg');
    const hit = wrap.querySelector('.run-chart-hitarea');
    const tip = document.getElementById('roChartTip');
    if (!hit || wrap.dataset.hoverWired) return;
    wrap.dataset.hoverWired = '1';
    function hide() { tip.classList.remove('show'); }
    function move(clientX) {
      const bars = wrap._chartBars;
      if (!bars || !bars.length) return;
      const svgRect = svg.getBoundingClientRect();
      const wrapRect = wrap.getBoundingClientRect();
      const vbX = (clientX - svgRect.left) / svgRect.width * 320;
      const bar = bars.find(function (b) { return vbX >= b.x && vbX <= b.x + b.w; }) || bars[bars.length - 1];
      const pxX = svgRect.left - wrapRect.left + ((bar.x + bar.w / 2) / 320) * svgRect.width;
      const pxY = svgRect.top - wrapRect.top + (bar.y / 104) * svgRect.height;
      tip.style.left = pxX + 'px';
      tip.style.top = pxY + 'px';
      tip.querySelector('.run-chart-tooltip-val').textContent = bar.label;
      tip.querySelector('.run-chart-tooltip-label').textContent = bar.sub || '';
      tip.classList.add('show');
    }
    hit.addEventListener('mousemove', function (e) { move(e.clientX); });
    hit.addEventListener('mouseleave', hide);
    hit.addEventListener('touchstart', function (e) { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
    hit.addEventListener('touchmove', function (e) { if (e.touches[0]) move(e.touches[0].clientX); }, { passive: true });
    hit.addEventListener('touchend', hide);
  }
  function renderMileageChart() {
    const wrap = document.getElementById('roChartWrap');
    if (!wrap) return;
    const empty = document.getElementById('roChartEmpty');
    const content = document.getElementById('roChartContent');
    const series = weeklyMileageSeries12();
    const data = series.map(function (d) { return d.value; });
    const nonZero = data.filter(function (v) { return v > 0; });
    if (nonZero.length === 0) {
      empty.style.display = 'block';
      content.innerHTML = '';
      wrap.querySelector('svg').style.display = 'none';
      wrap.querySelector('.run-chart-yaxis').style.display = 'none';
      return;
    }
    empty.style.display = 'none';
    wrap.querySelector('svg').style.display = 'block';
    wrap.querySelector('.run-chart-yaxis').style.display = 'flex';

    const max = Math.max.apply(null, data) || 1;
    const xLeft = 6, xRight = 314, yTop = 8, yBot = 96;
    const n = data.length;
    const gap = 4;
    const barW = (xRight - xLeft - gap * (n - 1)) / n;
    let html = '';
    const bars = [];
    series.forEach(function (d, i) {
      const h = (d.value / max) * (yBot - yTop);
      const x = xLeft + i * (barW + gap);
      const y = yBot - h;
      html += '<rect x="' + x.toFixed(2) + '" y="' + y.toFixed(2) + '" width="' + barW.toFixed(2) + '" height="' + Math.max(1, h).toFixed(2) + '" rx="2.5" fill="#20A5A0" opacity="' + (i === n - 1 ? '1' : '0.55') + '"></rect>';
      bars.push({ x: x, w: barW, y: y, label: fmtKm(d.value) || '0 km', sub: d.sub });
    });
    content.innerHTML = html;
    wrap._chartBars = bars;
    document.getElementById('roChartMax').textContent = fmtKm(max) || '—';
    document.getElementById('roChartMin').textContent = '0 km';
    wireMileageChartHover();
  }

  function renderRunningOverview() {
    const card = document.getElementById('runningOverview');
    if (!card) return;
    const allRuns = runs();
    const snap = load('run:garminSnapshot', null);
    const goal = load('run:goal', null);
    renderMileageChart();

    // Latest run — sort by date, then time-of-day where known (Garmin runs
    // carry it; see running.html's sortedRuns for why that matters).
    function sortKey(r) { return r.date + ' ' + (r.time || '00:00:00'); }
    const latest = allRuns.length ? allRuns.slice().sort((a, b) => sortKey(a).localeCompare(sortKey(b))).pop() : null;
    if (latest) {
      const km = fmtKm(latest.distanceKm);
      const pace = (latest.distanceKm > 0 && latest.durationSec > 0) ? fmtPace(latest.durationSec / latest.distanceKm) : null;
      document.getElementById('roLatestEyebrow').textContent = latest.type + ' — ' + latest.date;
      document.getElementById('roLatestDist').textContent = km || '—';
      document.getElementById('roLatestPace').textContent = pace || '';
    } else {
      document.getElementById('roLatestEyebrow').textContent = 'Latest Run';
      document.getElementById('roLatestDist').textContent = '—';
      document.getElementById('roLatestPace').textContent = '';
    }

    // This week's mileage (Mon–Sun, matches running.html's own week window)
    const monday = mondayOf(new Date());
    const days = []; for (let i = 0; i < 7; i++) { const d = new Date(monday); d.setDate(d.getDate() + i); days.push(dateKeyOf(d)); }
    const startKey = days[0], endKey = days[6];
    const weekKm = allRuns.filter(r => r.date >= startKey && r.date <= endKey).reduce((s, r) => s + (r.distanceKm || 0), 0);
    document.getElementById('roWeekDist').textContent = weekKm > 0 ? fmtKm(weekKm) : '—';

    // VO2 Max (Garmin-only — no manual equivalent)
    document.getElementById('roVo2Max').textContent = (snap && snap.vo2Max) ? snap.vo2Max : '—';

    // Longest run in the last 90 days
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 90);
    const cutoffKey = dateKeyOf(cutoff);
    const recent = allRuns.filter(r => r.date >= cutoffKey);
    const longest = recent.length ? recent.reduce((m, r) => Math.max(m, r.distanceKm || 0), 0) : null;
    document.getElementById('roLongestRecent').textContent = longest ? fmtKm(longest) : '—';

    // Marathon training progress (same plan running.html's Overview card shows)
    const pill = document.getElementById('roMarathonPill');
    const weekEl = document.getElementById('roMarathonWeek');
    if (goal && goal.raceDate && goal.planStartDate) {
      const daysLeft = daysBetween(dateKeyOf(new Date()), goal.raceDate);
      pill.textContent = (daysLeft >= 0 ? daysLeft : 0) + ' days to ' + (goal.raceName || 'race');
      const total = goal.planTotalWeeks || 1;
      const wk = Math.max(1, Math.min(total, Math.floor(daysBetween(goal.planStartDate, dateKeyOf(new Date())) / 7) + 1));
      weekEl.textContent = 'Week ' + wk + ' / ' + total;
    } else {
      pill.textContent = 'Set up in Running →';
      weekEl.textContent = '—';
    }
  }

  renderRunningOverview();
  window.addEventListener('storage', renderRunningOverview);

  document.addEventListener('DOMContentLoaded', function () {
    if (typeof initCloudSync !== 'function') return;
    initCloudSync({
      appKey: 'running',
      syncedPrefixes: ['run:'],
      onApplied: function () {
        renderRunningOverview();
        window.dispatchEvent(new Event('storage'));
      }
    });
  });
})();
