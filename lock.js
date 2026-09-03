// =============================================================
// Simple client-side passcode gate for the dashboard hub.
// Not real security (anyone with dev tools can bypass it) — just a
// light deterrent so the hub doesn't sit wide open on a shared device.
// Drop on a page with a plain (non-deferred) <script src="lock.js"></script>
// placed early in <head> so it can hide the page before first paint.
// =============================================================
(function () {
  'use strict';

  var LOCK_KEY = 'dash_unlocked_v1';
  var PIN = '9151';

  if (localStorage.getItem(LOCK_KEY) === '1') return; // already unlocked this device

  // Hide the page immediately so nothing flashes before the gate renders.
  document.documentElement.style.visibility = 'hidden';

  function boot() {
    document.documentElement.style.visibility = '';
    injectStyle();
    var overlay = buildOverlay();
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';

    var dots = overlay.querySelectorAll('.lock-dot');
    var entered = '';

    function render() {
      dots.forEach(function (d, i) {
        d.classList.toggle('filled', i < entered.length);
      });
    }

    function tryUnlock() {
      if (entered === PIN) {
        localStorage.setItem(LOCK_KEY, '1');
        document.body.style.overflow = '';
        overlay.remove();
      } else {
        var card = overlay.querySelector('.lock-card');
        card.classList.add('shake');
        setTimeout(function () {
          card.classList.remove('shake');
          entered = '';
          render();
        }, 380);
      }
    }

    function press(digit) {
      if (entered.length >= PIN.length) return;
      entered += digit;
      render();
      if (entered.length === PIN.length) setTimeout(tryUnlock, 120);
    }

    overlay.querySelectorAll('.lock-key').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var k = btn.getAttribute('data-key');
        if (k === 'back') {
          entered = entered.slice(0, -1);
          render();
        } else {
          press(k);
        }
      });
      // CSS :active alone is unreliable on iOS Safari without a touch
      // listener present, and with pinch-zoom still allowed on this page
      // (no maximum-scale in the viewport meta), a plain tap without
      // touch-action:manipulation waits briefly to rule out a double-tap
      // zoom before the click fires — on a fast passcode entry that reads
      // as an occasional missed/laggy key. touch-action (in the CSS)
      // removes that wait; this just makes the key visibly light up the
      // instant a finger lands, like the real iOS passcode pad, rather
      // than only on the (already-delayed) click.
      btn.addEventListener('touchstart', function () {
        btn.classList.add('is-pressed');
      }, { passive: true });
      ['touchend', 'touchcancel'].forEach(function (evt) {
        btn.addEventListener(evt, function () {
          btn.classList.remove('is-pressed');
        });
      });
    });

    document.addEventListener('keydown', function (e) {
      if (!document.body.contains(overlay)) return;
      if (/^[0-9]$/.test(e.key)) press(e.key);
      else if (e.key === 'Backspace') { entered = entered.slice(0, -1); render(); }
    });
  }

  function buildOverlay() {
    var wrap = document.createElement('div');
    wrap.id = 'lockOverlay';
    wrap.innerHTML =
      '<div class="lock-card">' +
      '  <div class="lock-emoji">🔒</div>' +
      '  <div class="lock-title">Enter Passcode</div>' +
      '  <div class="lock-dots">' +
      '    <span class="lock-dot"></span><span class="lock-dot"></span>' +
      '    <span class="lock-dot"></span><span class="lock-dot"></span>' +
      '  </div>' +
      '  <div class="lock-keypad">' +
      ['1','2','3','4','5','6','7','8','9','','0','back'].map(function (k) {
        if (k === '') return '<span></span>';
        if (k === 'back') return '<button type="button" class="lock-key lock-key-back" data-key="back" aria-label="Backspace">⌫</button>';
        return '<button type="button" class="lock-key" data-key="' + k + '">' + k + '</button>';
      }).join('') +
      '  </div>' +
      '</div>';
    return wrap;
  }

  function injectStyle() {
    var css = `
#lockOverlay {
  position: fixed; inset: 0; z-index: 99999;
  display: flex; align-items: center; justify-content: center;
  background:
    radial-gradient(circle at 82% 14%, rgba(8, 124, 163, 0.14), transparent 45%),
    radial-gradient(circle at 18% 90%, rgba(85, 32, 128, 0.18), transparent 50%),
    #10151A;
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
.lock-card {
  width: min(300px, 86vw);
  padding: 32px 24px;
  border-radius: 20px;
  background: #19232D;
  border: 1px solid rgba(120, 160, 180, 0.15);
  box-shadow: 0 12px 40px rgba(0,0,0,0.45);
  display: flex; flex-direction: column; align-items: center;
}
.lock-card.shake { animation: lock-shake 0.38s ease; }
@keyframes lock-shake {
  0%, 100% { transform: translateX(0); }
  20%      { transform: translateX(-8px); }
  40%      { transform: translateX(7px); }
  60%      { transform: translateX(-5px); }
  80%      { transform: translateX(3px); }
}
.lock-emoji { font-size: 28px; margin-bottom: 8px; }
.lock-title {
  font-size: 15px; font-weight: 700;
  color: #F2F2F2;
  letter-spacing: -0.01em;
  margin-bottom: 20px;
}
.lock-dots { display: flex; gap: 12px; margin-bottom: 26px; }
.lock-dot {
  width: 12px; height: 12px; border-radius: 50%;
  border: 1px solid rgba(120,160,180,0.35);
  background: transparent;
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
}
.lock-dot.filled {
  background: #087CA3;
  border-color: #087CA3;
  box-shadow: 0 0 8px rgba(8,124,163,0.7);
}
.lock-keypad {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 12px;
  width: 100%;
}
.lock-key {
  aspect-ratio: 1;
  border-radius: 50%;
  border: 1px solid rgba(120,160,180,0.15);
  background: #202B35;
  color: #F2F2F2;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 18px; font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  /* Without this, a tap here waits to see if it's the first half of a
     double-tap-to-zoom (pinch-zoom is still allowed on this page)
     before the click actually fires — the delay that reads as keys
     occasionally not registering on a fast passcode entry. */
  touch-action: manipulation;
  user-select: none;
  transition: background 0.1s, border-color 0.1s;
}
.lock-key:hover { background: #26343E; border-color: rgba(8,124,163,0.35); }
.lock-key:active, .lock-key.is-pressed {
  background: rgba(8,124,163,0.28);
  border-color: rgba(8,124,163,0.5);
  transition: none;
}
.lock-key-back { font-size: 15px; color: #687580; }
`;
    var style = document.createElement('style');
    style.id = 'lock-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})();
