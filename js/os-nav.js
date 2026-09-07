// =============================================================
// 88YYDS AIO — global top-level nav shared by every page: a compact
// strip with a Home link back to index.html, and a LIFE/WORK pill
// that jumps straight into the other environment's own dashboard
// (never routes back through index.html to switch). Self-injecting,
// same pattern as topbar.js — drop in with:
//     <script src="/js/os-nav.js" defer></script>
// On Life pages this loads alongside topbar.js (after it, in source
// order) so this bar ends up stacked above topbar's sticky bar; on
// Work pages and the Home page it's the only chrome.
// =============================================================
(function () {
  'use strict';

  const NAV_HEIGHT = 46;

  const css = `
.os-nav {
  position: sticky; top: 0; z-index: 41;
  display: flex; align-items: center; justify-content: space-between;
  gap: 12px;
  height: ${NAV_HEIGHT}px;
  padding: 0 max(14px, env(safe-area-inset-left)) 0 max(14px, env(safe-area-inset-right));
  background: #10151A;
  border-bottom: 1px solid rgba(120, 160, 180, 0.15);
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
}
.os-nav-home {
  display: inline-flex; align-items: baseline; gap: 6px;
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  opacity: 0.92;
  transition: opacity 0.15s;
}
.os-nav-home:hover { opacity: 1; }
.os-nav-logo-mark {
  font-size: 14px; font-weight: 800;
  letter-spacing: -0.02em;
  text-transform: uppercase;
  padding-right: 0.05em;
  background: linear-gradient(120deg, #FFFFFF 0%, #EAF1F5 38%, #9FD9DA 68%, #C9A6EE 100%);
  -webkit-background-clip: text; background-clip: text;
  -webkit-text-fill-color: transparent; color: transparent;
  white-space: nowrap;
}
.os-nav-logo-orb {
  align-self: center;
  flex-shrink: 0;
  width: 5px; height: 5px;
  margin-left: -2px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #F1E0FF 0%, #B98AE0 45%, #552080 100%);
  box-shadow: 0 0 8px 1px rgba(168, 63, 175, 0.5);
}
.os-nav-logo-kicker {
  font-size: 9px; font-weight: 700; letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #687580;
  white-space: nowrap;
}
.os-nav-switch {
  display: inline-flex; align-items: center;
  padding: 3px; gap: 2px;
  border-radius: 999px;
  background: #19232D;
  border: 1px solid rgba(120, 160, 180, 0.15);
}
.os-nav-switch a {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 6px 13px;
  border-radius: 999px;
  font-size: 12px; font-weight: 700; letter-spacing: 0.03em;
  text-decoration: none; color: #687580;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s, color 0.15s;
}
.os-nav-switch a:hover { color: #AEB7C0; }
.os-nav-switch a .os-nav-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: currentColor; opacity: 0.5; flex-shrink: 0;
}
.os-nav-switch a.is-active {
  color: #F2F2F2;
  background: linear-gradient(180deg, rgba(8, 124, 163, 0.28), rgba(85, 32, 128, 0.22));
}
.os-nav-switch a.is-active .os-nav-dot { opacity: 1; box-shadow: 0 0 6px currentColor; }
@media (max-width: 480px) {
  .os-nav { padding: 0 10px; }
  .os-nav-logo-kicker { display: none; }
  .os-nav-switch a { padding: 6px 10px; font-size: 11.5px; }
}
`;

  const html = `
<header class="os-nav" id="osNav" role="navigation" aria-label="88YYDS AIO">
  <a href="/index.html" class="os-nav-home" aria-label="88YYDS AIO home">
    <span class="os-nav-logo-mark">88YYDS</span>
    <span class="os-nav-logo-orb"></span>
    <span class="os-nav-logo-kicker">AIO</span>
  </a>
  <nav class="os-nav-switch" aria-label="Switch environment">
    <a href="/life/index.html" data-env="life"><span class="os-nav-dot"></span>Life</a>
    <a href="/work/index.html" data-env="work"><span class="os-nav-dot"></span>Work</a>
  </nav>
</header>`;

  function currentEnv() {
    const p = (window.location.pathname || '').toLowerCase();
    if (p.indexOf('/life/') !== -1) return 'life';
    if (p.indexOf('/work/') !== -1) return 'work';
    return null;
  }

  function isEmbedded() {
    try { return window.self !== window.top; } catch (e) { return true; }
  }

  function boot() {
    if (isEmbedded() || document.getElementById('osNav')) return;
    const style = document.createElement('style');
    style.id = 'os-nav-style';
    style.textContent = css;
    document.head.appendChild(style);
    const wrap = document.createElement('div');
    wrap.innerHTML = html.trim();
    document.body.insertBefore(wrap.firstChild, document.body.firstChild);

    const env = currentEnv();
    document.querySelectorAll('.os-nav-switch a').forEach((a) => {
      a.classList.toggle('is-active', a.getAttribute('data-env') === env);
    });

    // topbar.js (Life pages only) injects its own sticky bar at top:0 —
    // nudge it below this one so the two stack instead of overlapping.
    const topbar = document.getElementById('topbar');
    if (topbar) topbar.style.top = NAV_HEIGHT + 'px';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
