// =============================================================
// Every initCloudSync() channel main.html opens, in one place. Each
// appKey maps to one app_state row, so a channel per data family keeps
// an edit to goals from re-pushing the whole page's storage.
// =============================================================
document.addEventListener('DOMContentLoaded', function () {
  if (typeof initCloudSync !== 'function') return;
  initCloudSync({
    appKey: 'goals',
    syncedPrefixes: ['goals:'],
    onApplied: function () {
      window.dispatchEvent(new CustomEvent('goals-changed'));
      window.dispatchEvent(new Event('storage'));
    }
  });
  initCloudSync({
    appKey: 'nightroutine',
    syncedPrefixes: ['nightroutine:'],
    onApplied: function () {
      window.dispatchEvent(new Event('storage'));
    }
  });
  // Ready for a future Garmin sleep sync (mirroring garmin-sync.py's
  // 'running' channel) to push sleep:<date> entries in directly — this
  // registration is what makes that show up here without any other
  // change once it exists.
  initCloudSync({
    appKey: 'sleep',
    syncedPrefixes: ['sleep:'],
    onApplied: function () {
      window.dispatchEvent(new Event('storage'));
    }
  });
  // North Star + Your Goals preview read goals-data.js's 'strategic:'
  // keys — this channel keeps that data pulled in from another device
  // (e.g. a goal edited on goals.html on your phone) even if goals.html
  // itself hasn't been opened on this device yet. The preview here is
  // read-only, but registering the channel is still what makes edits
  // made through goals-data.js (from anywhere) actually push.
  initCloudSync({
    appKey: 'strategicGoals',
    syncedPrefixes: ['strategic:'],
    onApplied: function () {
      window.dispatchEvent(new CustomEvent('strategic-goals-changed'));
    }
  });

  // Water is guarded on not being framed: po-water.html embedded in
  // another page would otherwise open a second channel on the same row.
  try { if (window.self !== window.top) return; } catch (e) { return; }
  initCloudSync({
    appKey: 'water',
    syncedKeys: ['po_water_v1'],
    onApplied: function () { window.dispatchEvent(new Event('storage')); }
  });
});
