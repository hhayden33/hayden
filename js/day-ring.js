// =============================================================
// The waking-hours progress ring in .status-row. Purely a clock —
// it reads no stored data, so it stays correct on a page that has
// never been used.
// =============================================================
(function () {
  'use strict';

  const Dash = window.Dash;
  const pad2 = Dash.pad2;

  const WAKE_HOUR  = 7;
  const SLEEP_HOUR = 23.5;
  const RING_BLUE = '#087CA3';

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
  const fillEl = document.getElementById('dayRingFill');
  fillEl.setAttribute('stroke-dasharray', C);
  fillEl.setAttribute('stroke-dashoffset', C);

  function updateDayRing() {
    const now = new Date();
    const hours = now.getHours() + now.getMinutes() / 60 + now.getSeconds() / 3600;
    const percentEl   = document.getElementById('dayRingPercent');
    const phaseEl     = document.getElementById('dayRingPhase');
    const clockEl     = document.getElementById('dayRingClock');
    const statusEl    = document.getElementById('dayRingStatus');
    const remainingEl = document.getElementById('dayRingRemaining');

    clockEl.textContent = formatClock(now);

    if (hours < WAKE_HOUR) {
      fillEl.setAttribute('stroke-dashoffset', C);
      fillEl.style.stroke = '#4A5560';
      percentEl.textContent = '—';
      phaseEl.textContent   = 'SLEEPING';
      statusEl.textContent  = '😴 Still sleeping';
      const minsUntil = (WAKE_HOUR - hours) * 60;
      remainingEl.textContent = formatRemaining(minsUntil) + ' until wake-up';
      return;
    }

    if (hours >= SLEEP_HOUR) {
      fillEl.setAttribute('stroke-dashoffset', 0);
      fillEl.style.stroke = '#E25D7A';
      percentEl.textContent = '100%';
      phaseEl.textContent   = 'PAST BEDTIME';
      statusEl.textContent  = '⚠️ Past bedtime';
      remainingEl.textContent = 'Sleep!';
      return;
    }

    const span = SLEEP_HOUR - WAKE_HOUR;
    const percent = (hours - WAKE_HOUR) / span * 100;
    fillEl.setAttribute('stroke-dashoffset', C * (1 - percent / 100));
    fillEl.style.stroke = RING_BLUE;
    percentEl.textContent = Math.floor(percent) + '%';

    let phase, status;
    if (percent < 25)      { phase = 'MORNING';   status = '☀️ Morning — fresh start'; }
    else if (percent < 50) { phase = 'MIDDAY';    status = '⚡ Midday — keep moving'; }
    else if (percent < 75) { phase = 'AFTERNOON'; status = '🔥 Afternoon — push it'; }
    else if (percent < 90) { phase = 'EVENING';   status = '⏳ Evening — wrap up'; }
    else                   { phase = 'BEDTIME';   status = '🌙 Bedtime soon'; }
    phaseEl.textContent  = phase;
    statusEl.textContent = status;

    const minsLeft = (SLEEP_HOUR - hours) * 60;
    remainingEl.textContent = formatRemaining(minsLeft) + ' awake time left';
  }

  updateDayRing();
  setInterval(updateDayRing, 60 * 1000);
})();
