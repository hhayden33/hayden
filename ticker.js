// =============================================================
// Status ticker — self-injecting shared chrome, same pattern as
// topbar.js: drop <script src="ticker.js" defer></script> on any page,
// AFTER topbar.js's own <script> tag. Both scripts do
// document.body.insertBefore(el, document.body.firstChild) on load;
// deferred scripts run in the order they appear in the document, so
// whichever one runs last ends up visually on top. Loading this after
// topbar.js is what puts the ticker above the topbar rather than below
// it — swap the tag order and it swaps which one is "very top".
//
// Reads the same localStorage keys main.html's own copies of this math
// read (sleep:<date>, run:runs, goals-data.js's fitness evidence) —
// duplicated here rather than imported so this works standalone on any
// page, same reasoning goals-data.js gives for its own date-math
// duplication: no shared module to pull from, and it's pure math, not
// business logic that could drift.
// =============================================================
(function () {
  'use strict';

  function isEmbedded() {
    try { return window.self !== window.top; } catch (e) { return true; }
  }
  if (isEmbedded()) return;

  const css = `
.ticker-banner {
  overflow: hidden;
  white-space: nowrap;
  padding: 7px 0;
  background: #10151A;
  border-bottom: 1px solid rgba(255,255,255,0.06);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 28px, #000 calc(100% - 28px), transparent);
  mask-image: linear-gradient(90deg, transparent, #000 28px, #000 calc(100% - 28px), transparent);
}
.ticker-banner-track {
  display: inline-flex;
  width: max-content;
  animation: ticker-scroll 34s linear infinite;
  will-change: transform;
}
.ticker-banner-item {
  display: inline-block;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.10em;
  text-transform: uppercase;
  color: #687580;
  white-space: nowrap;
}
@keyframes ticker-scroll {
  from { transform: translateX(0); }
  to   { transform: translateX(-50%); }
}
@media (prefers-reduced-motion: reduce) {
  .ticker-banner-track { animation: none; }
  .ticker-banner { overflow-x: auto; -webkit-mask-image: none; mask-image: none; }
}
@media (max-width: 480px) {
  .ticker-banner { padding: 6px 0; }
  .ticker-banner-item { font-size: 9px; letter-spacing: 0.08em; }
}
`;

  function injectStyle() {
    if (document.getElementById('ticker-style')) return;
    const style = document.createElement('style');
    style.id = 'ticker-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  function buildBanner() {
    if (document.getElementById('tickerBanner')) return document.getElementById('tickerBanner');
    const wrap = document.createElement('div');
    wrap.className = 'ticker-banner';
    wrap.id = 'tickerBanner';
    wrap.setAttribute('aria-hidden', 'true');
    wrap.innerHTML =
      '<div class="ticker-banner-track">' +
      '<span class="ticker-banner-item" id="tickerBannerItem1">—</span>' +
      '<span class="ticker-banner-item" id="tickerBannerItem2">—</span>' +
      '</div>';
    document.body.insertBefore(wrap, document.body.firstChild);
    return wrap;
  }

  // ---------- data ----------
  function pad2(n) { return String(n).padStart(2, '0'); }
  function dateToKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  // Same "day doesn't end until 6 AM" active-day boundary main.html's
  // Today card / Night Routine / Sleep all use.
  function getActiveDateString() {
    const now = new Date();
    if (now.getHours() < 6) {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return dateToKey(d);
    }
    return dateToKey(now);
  }
  function storeGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }

  function getSleep() {
    const s = storeGet('sleep:' + getActiveDateString());
    return (s && typeof s === 'object' && !Array.isArray(s)) ? s : null;
  }
  function formatSleepHours(hours) {
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return h + 'h' + (m ? ' ' + m + 'm' : '');
  }
  // Same estimate main.html's Sleep card ring uses until a real Garmin
  // score exists (s.score, set directly by a future sync) — hours up to
  // 70 of 100 points scaled against an 8h night, quality up to 30.
  function computeSleepScore(s) {
    if (!s) return null;
    if (s.score != null) return Math.max(0, Math.min(100, Math.round(s.score)));
    if (s.hours == null) return null;
    const hoursPts = Math.max(0, Math.min(70, s.hours / 8 * 70));
    const qualityPts = s.quality != null ? (s.quality / 5 * 30) : 15;
    return Math.round(hoursPts + qualityPts);
  }

  function weekRunningKm() {
    const runs = storeGet('run:runs');
    if (!Array.isArray(runs) || !runs.length) return null;
    const now = new Date();
    const monday = new Date(now);
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
    monday.setHours(0, 0, 0, 0);
    const days = [];
    for (let i = 0; i < 7; i++) { const d = new Date(monday); d.setDate(d.getDate() + i); days.push(dateToKey(d)); }
    const startKey = days[0], endKey = days[6];
    return runs.filter(function (r) { return r.date >= startKey && r.date <= endKey; })
      .reduce(function (sum, r) { return sum + (r.distanceKm || 0); }, 0);
  }
  function fmtKm(km) {
    const r = Math.round(km * 10) / 10;
    return r % 1 === 0 ? r.toFixed(0) : r.toFixed(1);
  }
  // Split-type coverage for the week (push/pull/legs/full) — the same
  // figure goals.html's "Train consistently" habit shows. Reads
  // GoalsData.Evidence.fitness() directly; goals-data.js just needs to
  // be present on the page (a plain <script> tag, no init required).
  function weekSessions() {
    const GD = window.GoalsData;
    if (!GD) return null;
    const ev = GD.Evidence.fitness();
    if (!ev) return null;
    return { done: ev.weekTypesDone.length, total: ev.weekTypesRequired.length };
  }

  function buildTickerText() {
    const now = new Date();
    const dow = now.toLocaleDateString('en-US', { weekday: 'long' }).toUpperCase();
    const day = now.getDate();
    const month = now.toLocaleDateString('en-US', { month: 'long' }).toUpperCase();
    const parts = [dow, day + ' ' + month];

    const sleep = getSleep();
    if (sleep && sleep.hours != null) parts.push('SLEEP ' + formatSleepHours(sleep.hours).toUpperCase());
    const score = computeSleepScore(sleep);
    if (score != null) parts.push('SCORE ' + score);

    const weekKm = weekRunningKm();
    if (weekKm != null) parts.push(fmtKm(weekKm) + ' KM THIS WEEK');

    const sessions = weekSessions();
    if (sessions) parts.push(sessions.done + ' / ' + sessions.total + ' SESSIONS');

    // Trailing separator baked into the string itself (not padding) so
    // the two identical copies read as one continuous stream with no
    // double-gap or missing-gap seam where they meet mid-loop.
    return parts.join(' · ') + '   ·   ';
  }

  function render(item1, item2) {
    const text = buildTickerText();
    item1.textContent = text;
    item2.textContent = text;
  }

  function boot() {
    injectStyle();
    const wrap = buildBanner();
    const item1 = document.getElementById('tickerBannerItem1');
    const item2 = document.getElementById('tickerBannerItem2');
    if (!item1 || !item2) return;
    render(item1, item2);
    setInterval(function () { render(item1, item2); }, 5 * 60 * 1000);
    window.addEventListener('storage', function () { render(item1, item2); });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
