// =============================================================
// Streak-at-risk nudge — at most one plain-text line, first matching
// rule wins. Read-only against every other module's key; the only
// thing this module writes is nudge:*.
//
// The suppression model: the moment a rule is about to be shown, its id
// is recorded in nudge:<activeDate> immediately (not only on Dismiss) —
// that's what makes "one nudge per rule per day maximum, dismissed or
// not" hold without a second piece of state. Dismiss just clears the
// current view early; the record already happened at render time.
// =============================================================
(function () {
  'use strict';

  const Dash = window.Dash;
  const getActiveDateString = Dash.getActiveDateString;
  const dateToKey = Dash.dateToKey;

  function storeGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function storeSetRaw(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

  function nudgeKey() { return 'nudge:' + getActiveDateString(); }
  function loadFired() {
    const v = storeGet(nudgeKey());
    return Array.isArray(v) ? v : [];
  }
  function markFired(ruleId) {
    const list = loadFired();
    if (list.indexOf(ruleId) === -1) { list.push(ruleId); storeSetRaw(nudgeKey(), list); }
  }
  function pruneOld() {
    const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 14);
    const cutoffKey = dateToKey(cutoff);
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (k && k.indexOf('nudge:') === 0 && k.slice(6) < cutoffKey) {
        try { localStorage.removeItem(k); } catch (e) {}
      }
    }
  }

  // Calendar dates going backward from today — valid for every tracker's
  // historical keys regardless of the 6 AM active-day boundary, since
  // that boundary only decides what "today" is called right now, not how
  // past days were keyed when they were written.
  function pastDates(n) {
    const out = [];
    const now = new Date();
    for (let i = 1; i <= n; i++) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      out.push(dateToKey(d));
    }
    return out;
  }
  function hasAnyDataInLast7(prefix, hasData) {
    return pastDates(7).some(function (dk) { return hasData(storeGet(prefix + dk)); });
  }

  // ---------- rule 1: night routine, 20:30-23:00 ----------
  function nightRoutineStreak() {
    let streak = 0;
    const now = new Date();
    for (let i = 1; i <= 60; i++) {
      const d = new Date(now); d.setDate(d.getDate() - i);
      const list = storeGet('nightroutine:' + dateToKey(d));
      if (!Array.isArray(list) || list.length === 0) break;
      const done = list.filter(function (x) { return x && x.done; }).length;
      if (done === list.length) streak++; else break;
    }
    return streak;
  }
  function ruleNightRoutine(t) {
    if (t < 20 * 60 + 30 || t > 23 * 60) return null;
    if (!hasAnyDataInLast7('nightroutine:', function (v) { return Array.isArray(v) && v.length > 0; })) return null;
    const list = storeGet('nightroutine:' + getActiveDateString());
    if (!Array.isArray(list) || list.length === 0) return null;
    const done = list.filter(function (x) { return x && x.done; }).length;
    const total = list.length;
    if (done >= total / 2) return null;
    const streak = nightRoutineStreak();
    if (streak < 2) return null; // includes "streak already broken" — show nothing, don't mention it
    return 'Night routine still open — ' + done + '/' + total + ' done. ' + streak + ' day run on the line.';
  }

  // ---------- rule 2: water, 17:00-21:00 ----------
  function ruleWater(t) {
    if (t < 17 * 60 || t > 21 * 60) return null;
    const state = storeGet('po_water_v1');
    if (!state || !state.logs) return null;
    const hasRecent = pastDates(7).some(function (dk) { return (state.logs[dk] || 0) > 0; });
    if (!hasRecent) return null;
    // water.js keys its logs by plain calendar date, not the active-day
    // boundary — read it the same way it writes it.
    const todayKey = dateToKey(new Date());
    const servings = state.logs[todayKey] || 0;
    const bottleMl = state.bottleMl || 500;
    const targetMl = state.useManualTarget ? Math.max(1, state.manualTargetMl || 3000) : 3000;
    const target = Math.ceil(targetMl / bottleMl);
    if (target <= 0 || servings / target > 0.6) return null;
    return servings + ' of ' + target + ' bottles. Two more before dinner keeps today green.';
  }

  // ---------- rule 3: goals, 19:00-22:30 ----------
  function ruleGoals(t) {
    if (t < 19 * 60 || t > 22 * 60 + 30) return null;
    if (!hasAnyDataInLast7('goals:', function (v) { return Array.isArray(v) && v.length > 0; })) return null;
    const list = storeGet('goals:' + getActiveDateString());
    if (!Array.isArray(list) || list.length === 0) return null;
    const done = list.filter(function (g) { return g && g.done; }).length;
    if (done > 0) return null;
    return 'Nothing ticked off today yet. Pick the smallest one.';
  }

  // ---------- rule 4: sleep, after 09:00 ----------
  function hasSleepData(v) { return !!(v && (v.hours != null || v.bedTime != null)); }
  function ruleSleep(t) {
    if (t < 9 * 60) return null;
    if (!hasAnyDataInLast7('sleep:', hasSleepData)) return null;
    const s = storeGet('sleep:' + getActiveDateString());
    if (hasSleepData(s)) return null;
    return "Last night's sleep isn't logged.";
  }

  const RULES = [
    { id: 'night', fn: ruleNightRoutine },
    { id: 'water', fn: ruleWater },
    { id: 'goals', fn: ruleGoals },
    { id: 'sleep', fn: ruleSleep }
  ];

  // ---------- render ----------
  function render(text, ruleId) {
    const slot = document.getElementById('nudgeSlot');
    if (!slot) return;
    if (!text) { slot.innerHTML = ''; return; }
    slot.innerHTML =
      '<div class="nudge-card"><div class="nudge-text"></div>' +
      '<button type="button" class="nudge-dismiss">Dismiss</button></div>';
    slot.querySelector('.nudge-text').textContent = text;
    slot.querySelector('.nudge-dismiss').addEventListener('click', function () {
      markFired(ruleId);
      slot.innerHTML = '';
    });
  }

  function evaluate() {
    pruneOld();
    const now = new Date();
    const hour = now.getHours();
    // Absolute blackout, no exceptions — 23:30 with the routine unfinished
    // means silence, not a prompt about a streak.
    if (hour >= 23 || hour < 6) { render(null); return; }
    const t = hour * 60 + now.getMinutes();
    const fired = loadFired();
    for (let i = 0; i < RULES.length; i++) {
      const rule = RULES[i];
      if (fired.indexOf(rule.id) !== -1) continue;
      const text = rule.fn(t);
      if (text) { markFired(rule.id); render(text, rule.id); return; }
    }
    render(null);
  }

  evaluate();
  setInterval(evaluate, 5 * 60 * 1000);
  window.addEventListener('storage', evaluate);
  window.addEventListener('goals-changed', evaluate);

  if (typeof window.initCloudSync === 'function') {
    window.initCloudSync({ appKey: 'nudge', syncedPrefixes: ['nudge:'], onApplied: evaluate });
  }
})();
