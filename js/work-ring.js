// =============================================================
// Work-day progress ring for work/index.html — same mechanism as
// js/day-ring.js (Life's waking-hours ring), re-parented to an
// 8:30 AM-6:00 PM work day instead of a 7:00 AM-11:30 PM waking day.
// Kept as its own small file rather than parameterizing day-ring.js:
// different element ids (workRing*), different copy for the two edge
// phases (before/after work vs. asleep/past bedtime), and no dependency
// on window.Dash (main.html's dash-core.js isn't loaded on Work pages).
// =============================================================
(function () {
  'use strict';

  const START_HOUR = 8.5;  // 8:30 AM
  const END_HOUR   = 18;   // 6:00 PM
  const RING_BLUE = '#087CA3';

  function pad2(n) { return String(n).padStart(2, '0'); }
  function formatClock(d) {
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12;
    if (h === 0) h = 12;
    return h + ':' + pad2(m) + ' ' + ampm;
  }
  function formatRemaining(totalMin) {
    const h = Math.floor(totalMin / 60);
    const m = Math.floor(totalMin % 60);
    return h + 'h ' + m + 'm';
  }

  const C = 2 * Math.PI * 52;
  const fillEl = document.getElementById('workRingFill');
  if (!fillEl) return;
  fillEl.setAttribute('stroke-dasharray', C);
  fillEl.setAttribute('stroke-dashoffset', C);

  function updateRing() {
    const now = new Date();
    const hours = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    const percentEl   = document.getElementById('workRingPercent');
    const phaseEl     = document.getElementById('workRingPhase');
    const clockEl     = document.getElementById('workRingClock');
    const statusEl    = document.getElementById('workRingStatus');
    const remainingEl = document.getElementById('workRingRemaining');

    clockEl.textContent = formatClock(now);

    if (hours < START_HOUR) {
      fillEl.setAttribute('stroke-dashoffset', C);
      fillEl.style.stroke = '#4A5560';
      percentEl.textContent = '—';
      phaseEl.textContent   = 'BEFORE WORK';
      statusEl.textContent  = '🌅 Not started yet';
      const minsUntil = (START_HOUR - hours) * 60;
      remainingEl.textContent = formatRemaining(minsUntil) + ' until start';
      return;
    }

    if (hours >= END_HOUR) {
      fillEl.setAttribute('stroke-dashoffset', 0);
      fillEl.style.stroke = '#20A5A0';
      percentEl.textContent = '100%';
      phaseEl.textContent   = 'DAY DONE';
      statusEl.textContent  = '✅ Work day done';
      remainingEl.textContent = 'Finished for today';
      return;
    }

    const span = END_HOUR - START_HOUR;
    const percent = (hours - START_HOUR) / span * 100;
    fillEl.setAttribute('stroke-dashoffset', C * (1 - percent / 100));
    fillEl.style.stroke = RING_BLUE;
    percentEl.textContent = Math.floor(percent) + '%';

    let phase, status;
    if (percent < 25)      { phase = 'MORNING';   status = '☀️ Morning — fresh start'; }
    else if (percent < 50) { phase = 'MIDDAY';    status = '⚡ Midday — keep moving'; }
    else if (percent < 75) { phase = 'AFTERNOON'; status = '🔥 Afternoon — push it'; }
    else if (percent < 90) { phase = 'EVENING';   status = '⏳ Evening — wrap up'; }
    else                   { phase = 'CLOCK OUT SOON'; status = '🌙 Nearly done'; }
    phaseEl.textContent  = phase;
    statusEl.textContent = status;

    const minsLeft = (END_HOUR - hours) * 60;
    remainingEl.textContent = formatRemaining(minsLeft) + ' left today';
  }

  updateRing();
  setInterval(updateRing, 60 * 1000);
})();
