(function () {
  'use strict';
  // Time-of-day hero greeting — reads the browser's local clock, so it's
  // always correct for whoever has the page open, not when it was built.
  const subEl = document.getElementById('heroGreetingSub');
  if (!subEl) return;

  function greetingForHour(h) {
    if (h >= 5 && h < 12) return 'Good morning';
    if (h >= 12 && h < 18) return 'Good afternoon';
    return 'Good evening';
  }
  function renderGreeting() {
    subEl.textContent = greetingForHour(new Date().getHours()) + ',';
  }
  renderGreeting();
  setInterval(renderGreeting, 60 * 1000);
})();
