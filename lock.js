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
  background: #050506;
  font-family: -apple-system, BlinkMacSystemFont, "Inter", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
}
.lock-card {
  width: min(300px, 86vw);
  padding: 32px 24px;
  border-radius: 20px;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(24px) saturate(1.2);
  -webkit-backdrop-filter: blur(24px) saturate(1.2);
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
  color: #FAFAFA;
  letter-spacing: -0.01em;
  margin-bottom: 20px;
}
.lock-dots { display: flex; gap: 12px; margin-bottom: 26px; }
.lock-dot {
  width: 12px; height: 12px; border-radius: 50%;
  border: 1px solid rgba(255,255,255,0.25);
  background: transparent;
  transition: background 0.15s, border-color 0.15s, box-shadow 0.15s;
}
.lock-dot.filled {
  background: #6BE3A4;
  border-color: #6BE3A4;
  box-shadow: 0 0 8px rgba(107,227,164,0.7);
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
  border: 1px solid rgba(255,255,255,0.08);
  background: rgba(255,255,255,0.04);
  color: #FAFAFA;
  font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  font-size: 18px; font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
  transition: background 0.15s, border-color 0.15s;
}
.lock-key:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.16); }
.lock-key:active { background: rgba(107,227,164,0.14); }
.lock-key-back { font-size: 15px; color: #76746E; }
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
