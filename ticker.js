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
  padding: max(7px, env(safe-area-inset-top)) 0 7px;
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
  .ticker-banner { padding: max(6px, env(safe-area-inset-top)) 0 6px; }
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
    wrap.innerHTML = '<div class="ticker-banner-track" id="tickerBannerTrack"></div>';
    document.body.insertBefore(wrap, document.body.firstChild);
    // Every page's <body> carries its own top padding sized for
    // whatever used to be the first element (topbar, or the page's own
    // content) to clear the iOS safe area. Now that this banner sits
    // above all of that as the new first child, that inherited padding
    // just reads as a stray gap of empty background before the ticker's
    // own content — cancel it here so the banner sits flush against the
    // true top of the viewport, then .ticker-banner's own
    // safe-area-aware padding (see the CSS above) re-adds exactly the
    // clearance the ticker itself needs, without double-counting it.
    const bodyPT = getComputedStyle(document.body).paddingTop;
    if (bodyPT && bodyPT !== '0px') wrap.style.marginTop = 'calc(-1 * ' + bodyPT + ')';
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

  // Fills the track with two IDENTICAL back-to-back "sets" of repeated
  // copies, each set wide enough on its own to cover the visible banner
  // (so on a wide desktop window a short ticker string never runs out
  // partway across, leaving the right side blank — the original bug:
  // two copies total was only ever enough to fill a narrow phone
  // screen). Both sets always have the same width by construction
  // (same copy count, same text), so animating exactly -50% still
  // loops with no seam regardless of viewport width or string length.
  function fillTrack(track, text) {
    const containerWidth = track.parentElement.clientWidth || window.innerWidth;
    track.innerHTML = '';
    const probe = document.createElement('span');
    probe.className = 'ticker-banner-item';
    probe.textContent = text;
    track.appendChild(probe);
    const itemWidth = probe.getBoundingClientRect().width || 1;
    const copiesPerSet = Math.max(1, Math.ceil(containerWidth / itemWidth));
    track.innerHTML = '';
    for (let set = 0; set < 2; set++) {
      for (let i = 0; i < copiesPerSet; i++) {
        const span = document.createElement('span');
        span.className = 'ticker-banner-item';
        span.textContent = text;
        track.appendChild(span);
      }
    }
  }

  let currentTickerText = '';
  function render(track) {
    currentTickerText = buildTickerText();
    fillTrack(track, currentTickerText);
  }

  function boot() {
    injectStyle();
    const wrap = buildBanner();
    const track = document.getElementById('tickerBannerTrack');
    if (!track) return;
    render(track);
    setInterval(function () { render(track); }, 5 * 60 * 1000);
    window.addEventListener('storage', function () { render(track); });
    // Re-fill on resize (debounced) — the copy count that avoids a gap
    // at 375px isn't necessarily enough at 1280px after a window resize
    // or an iPad rotating.
    let resizeTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(function () { fillTrack(track, currentTickerText); }, 200);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})();
