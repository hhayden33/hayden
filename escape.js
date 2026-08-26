// =============================================================
// One shared HTML-escape, used at every sink across every page that
// puts a stored or fetched string into an innerHTML template. Used to
// be six near-identical copies (goals.html, running.html, finance.html,
// gym.html, po-water.html, js/water.js) — one page's copy could drift
// from the others and nothing would catch it. Loaded without `defer`,
// same as goals-data.js, since inline <script> blocks later in the same
// page call it immediately, before deferred scripts would have run.
// =============================================================
(function () {
  'use strict';
  window.escapeHtml = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
})();
