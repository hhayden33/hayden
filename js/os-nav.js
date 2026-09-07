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
//
// Work pages also get a compact Water Coach widget here (topbar.js's
// own water pill only ever runs on Life pages) — same 'po_water_v1'
// key, same live count/add-a-drink button, and registered as a real
// initCloudSync channel (Work has no sync-register.js of its own) so
// a drink logged from Work pushes out and a drink logged elsewhere
// pulls in, not just a same-device localStorage read.
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
  margin-bottom: 20px;
  padding: 0 max(14px, env(safe-area-inset-left)) 0 max(14px, env(safe-area-inset-right));
  background: #10151A;
  border-bottom: 1px solid rgba(120, 160, 180, 0.15);
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, sans-serif;
}
.os-nav-home {
  display: inline-flex; align-items: baseline; gap: 8px;
  text-decoration: none;
  -webkit-tap-highlight-color: transparent;
  opacity: 0.92;
  transition: opacity 0.15s;
}
.os-nav-home:hover { opacity: 1; }
.os-nav-logo-mark {
  font-size: 21px; font-weight: 800;
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
  width: 8px; height: 8px;
  margin-left: -3px;
  border-radius: 50%;
  background: radial-gradient(circle at 35% 30%, #F1E0FF 0%, #B98AE0 45%, #552080 100%);
  box-shadow: 0 0 12px 2px rgba(168, 63, 175, 0.55);
}
.os-nav-logo-kicker {
  font-size: 11px; font-weight: 700; letter-spacing: 0.18em;
  text-transform: uppercase;
  color: #687580;
  white-space: nowrap;
}
.os-nav-right {
  display: inline-flex; align-items: center; gap: 10px;
}
.os-nav-water-wrap { display: flex; align-items: stretch; flex-shrink: 0; }
.os-nav-water-pill {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 0 10px;
  background: rgba(8, 124, 163, 0.10);
  border: 1px solid rgba(8, 124, 163, 0.22);
  border-right: none;
  border-radius: 10px 0 0 10px;
  text-decoration: none; color: #F2F2F2;
  -webkit-tap-highlight-color: transparent;
}
.os-nav-water-emoji { font-size: 12px; line-height: 1; flex-shrink: 0; }
.os-nav-water-dot {
  width: 6px; height: 6px; border-radius: 50%;
  background: #087CA3; flex-shrink: 0;
}
.os-nav-water-pill.warn .os-nav-water-dot { background: #fbbf24; }
.os-nav-water-pill.miss .os-nav-water-dot {
  background: #ff8a8a;
  animation: os-nav-miss-pulse 1.6s ease-in-out infinite;
}
@keyframes os-nav-miss-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(239, 68, 68, 0.5); }
  50%      { box-shadow: 0 0 0 4px rgba(239, 68, 68, 0); }
}
.os-nav-water-count {
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 11px; font-weight: 700; color: #F2F2F2;
  font-variant-numeric: tabular-nums; white-space: nowrap;
}
.os-nav-water-add {
  width: 28px;
  border: 1px solid rgba(8, 124, 163, 0.22);
  background: linear-gradient(180deg, rgba(8, 124, 163, 0.45), rgba(85, 32, 128, 0.45));
  color: #F2F2F2; font-family: inherit;
  font-size: 15px; font-weight: 700; line-height: 1;
  cursor: pointer; border-radius: 0 10px 10px 0;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s, transform 0.10s;
}
.os-nav-water-add:active { transform: scale(0.92); }
.os-nav-water-add.flash { background: linear-gradient(180deg, rgba(8, 124, 163, 0.85), rgba(85, 32, 128, 0.85)); }
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
  .os-nav { padding: 0 10px; gap: 8px; }
  .os-nav-home { gap: 5px; }
  .os-nav-logo-mark { font-size: 14px; }
  .os-nav-logo-orb { width: 5px; height: 5px; margin-left: -2px; }
  .os-nav-logo-kicker { font-size: 8px; letter-spacing: 0.12em; }
  .os-nav-right { gap: 6px; }
  .os-nav-water-count { display: none; }
  .os-nav-water-pill { padding: 0 8px; }
  .os-nav-water-add { width: 26px; }
  .os-nav-switch { padding: 2px; gap: 1px; }
  .os-nav-switch a { padding: 5px 9px; font-size: 11px; gap: 4px; }
}
@media (max-width: 340px) {
  .os-nav-logo-kicker { display: none; }
}
`;

  const WATER_HTML = `
<div class="os-nav-water-wrap">
  <a href="/life/health.html" class="os-nav-water-pill" id="osNavWater" aria-label="Water Coach">
    <span class="os-nav-water-emoji">🥛</span>
    <span class="os-nav-water-dot"></span>
    <span class="os-nav-water-count" id="osNavWaterCount">0/0</span>
  </a>
  <button class="os-nav-water-add" id="osNavWaterAdd" type="button" aria-label="Log one drink">+</button>
</div>`;

  const html = `
<header class="os-nav" id="osNav" role="navigation" aria-label="88YYDS AIO">
  <a href="/index.html" class="os-nav-home" aria-label="88YYDS AIO home">
    <span class="os-nav-logo-mark">88YYDS</span>
    <span class="os-nav-logo-orb"></span>
    <span class="os-nav-logo-kicker">AIO</span>
  </a>
  <div class="os-nav-right" id="osNavRight">
    <nav class="os-nav-switch" aria-label="Switch environment">
      <a href="/life/index.html" data-env="life"><span class="os-nav-dot"></span>Life</a>
      <a href="/work/index.html" data-env="work"><span class="os-nav-dot"></span>Work</a>
    </nav>
  </div>
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

  // ---------- Water Coach widget (Work pages only) ----------
  function calendarDateKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function defaultWaterState() {
    return {
      unit: 'bottle', bottleMl: 500, glassMl: 250, weightUnit: 'kg',
      profile: { weightKg: 75, age: 25, sex: 'm', activityHrsPerWeek: 5 },
      caffeineMgPerDay: 200, substances: [], logs: {}
    };
  }
  function getWaterProgress() {
    let state = null;
    try { state = JSON.parse(localStorage.getItem('po_water_v1')); } catch (e) {}
    if (!state) return { done: 0, total: 0 };
    const todayKey = calendarDateKey();
    const done = (state.logs || {})[todayKey] || 0;
    const p = state.profile || { weightKg: 75 };
    let totalMl;
    if (state.useManualTarget) {
      totalMl = state.manualTargetMl || 0;
    } else {
      const wKg = state.weightUnit === 'lb' ? (p.weightKg || 0) / 2.20462 : (p.weightKg || 0);
      const base = wKg * 35;
      const exercise = (p.activityHrsPerWeek || 0) / 7 * 500;
      const caffeine = Math.max(0, (state.caffeineMgPerDay || 0) - 200) * 1.5;
      const subs = (state.substances || []).reduce((s, x) => {
        const dose = (x && x.dose != null ? x.dose : (x && x.defaultDose)) || 0;
        return s + Math.max(0, dose * ((x && x.mlPerUnit) || 0));
      }, 0);
      let adjust = 0;
      if (p.sex === 'm') adjust += 200;
      if ((p.age || 0) >= 50) adjust += 100;
      totalMl = base + exercise + caffeine + subs + adjust;
    }
    let unitVol;
    if (state.unit === 'glass') unitVol = state.glassMl || 250;
    else if (state.unit === 'oz') unitVol = 30;
    else if (state.unit === 'ml') unitVol = 1;
    else unitVol = state.bottleMl || 500;
    const total = Math.max(1, Math.ceil(totalMl / unitVol));
    return { done, total };
  }
  function classifyWaterStatus(done, total) {
    if (total === 0) return 'idle';
    if (done >= total) return 'good';
    if (done >= total * 0.5) return 'warn';
    const h = new Date().getHours();
    if (h >= 18 && done < total * 0.5) return 'miss';
    return 'warn';
  }
  function renderWater() {
    const pillEl = document.getElementById('osNavWater');
    if (!pillEl) return;
    const w = getWaterProgress();
    const countEl = document.getElementById('osNavWaterCount');
    if (countEl) countEl.textContent = w.total ? w.done + '/' + w.total : '0/0';
    const status = classifyWaterStatus(w.done, w.total);
    pillEl.classList.remove('good', 'warn', 'miss');
    if (status === 'warn' || status === 'miss') pillEl.classList.add(status);
  }
  function addWater() {
    let state = null;
    try { state = JSON.parse(localStorage.getItem('po_water_v1')); } catch (e) {}
    if (!state || typeof state !== 'object') state = defaultWaterState();
    state.logs = state.logs || {};
    const k = calendarDateKey();
    state.logs[k] = (state.logs[k] || 0) + 1;
    // A plain setItem — if sync.js's initCloudSync has this key registered
    // (wireWaterSync below, Work pages only) it's already monkey-patched
    // localStorage.setItem to push this out on its own.
    try { localStorage.setItem('po_water_v1', JSON.stringify(state)); } catch (e) {}
    renderWater();
    const btn = document.getElementById('osNavWaterAdd');
    if (btn) { btn.classList.add('flash'); setTimeout(() => btn.classList.remove('flash'), 220); }
  }
  function wireWaterSync() {
    // Work has no sync-register.js of its own (that's a Life-only file
    // covering goals/nightroutine/sleep/hevy/strategicGoals/water) — this
    // is the one channel Work actually needs, opened here instead so a
    // drink logged from Work pushes out and one logged elsewhere pulls in.
    if (typeof window.initCloudSync !== 'function') return;
    window.initCloudSync({
      appKey: 'water',
      syncedKeys: ['po_water_v1'],
      onApplied: function () { renderWater(); }
    });
  }
  function bootWater() {
    const right = document.getElementById('osNavRight');
    if (!right) return;
    const wrap = document.createElement('div');
    wrap.innerHTML = WATER_HTML.trim();
    right.insertBefore(wrap.firstChild, right.firstChild);
    const btn = document.getElementById('osNavWaterAdd');
    if (btn) btn.addEventListener('click', function (e) { e.preventDefault(); addWater(); });
    renderWater();
    wireWaterSync();
    window.addEventListener('storage', renderWater);
    window.addEventListener('focus', renderWater);
    document.addEventListener('visibilitychange', function () { if (!document.hidden) renderWater(); });
    setInterval(renderWater, 30 * 1000);
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

    if (env === 'work') bootWater();

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
