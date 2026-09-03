// =============================================================
// Night Routine — the evening wind-down checklist. Exposes its
// renderer so goals.js can re-run it when it notices the 6 AM
// boundary flip or a cross-tab storage write.
// =============================================================
(function () {
  'use strict';

  const Dash = window.Dash;
  const storeGet = Dash.storeGet;
  const storeSet = Dash.storeSet;
  const getActiveDateString = Dash.getActiveDateString;
  const makeInlineEdit = Dash.makeInlineEdit;

  const NIGHT_ROUTINE_ITEMS = [
    'Prepare clothes for tomorrow',
    'Pack work/gym bag',
    "Review tomorrow's schedule",
    'Complete remaining tasks',
    'Prepare water',
    'Charge Garmin/watch',
    'Brush teeth / skincare',
    'No phone',
    'Get into bed'
  ];
  function nightRoutineKey() { return 'nightroutine:' + getActiveDateString(); }
  // Same items every night, but a fresh (unchecked) list each active day —
  // carries a checked item's done state forward only if that exact item is
  // still checked from *before* the day boundary flipped (handles the page
  // just staying open across the 6 AM rollover).
  function getNightRoutine() {
    const key = nightRoutineKey();
    let list = storeGet(key);
    // Only seed the default 9 the first time this active day is seen —
    // once a list exists, a shorter one is left alone rather than being
    // topped back up to 9. There's no delete button anymore though, so
    // the only way a list ever ends up empty is a bug (e.g. a stale
    // cross-date sync tombstone matching every item by its text-derived
    // id) rather than something the user actually did — treat that the
    // same as "never seeded" instead of showing a permanently empty
    // checklist.
    if (!Array.isArray(list) || list.length === 0) {
      list = NIGHT_ROUTINE_ITEMS.map(text => ({ text, done: false }));
      storeSet(key, list);
    }
    return list;
  }
  function setNightRoutine(list) { storeSet(nightRoutineKey(), list); }

  function buildNightRoutineRow(item, idx) {
    const li = document.createElement('li');
    li.className = 'gm-row nr-row';
    if (item.done) li.classList.add('gm-row-done');

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'gm-check';
    cb.checked = !!item.done;
    cb.addEventListener('change', () => {
      const list = getNightRoutine();
      if (!list[idx]) return;
      list[idx].done = cb.checked;
      setNightRoutine(list);
      renderNightRoutine();
    });
    li.appendChild(cb);

    const text = document.createElement('span');
    text.className = 'nr-text';
    text.textContent = item.text;
    li.appendChild(text);
    makeInlineEdit(text, idx, getNightRoutine, setNightRoutine, renderNightRoutine);

    return li;
  }
  function renderNightRoutine() {
    const list = getNightRoutine();
    const ul = document.getElementById('nightRoutineList');
    if (!ul) return;
    ul.innerHTML = '';
    list.forEach((item, i) => ul.appendChild(buildNightRoutineRow(item, i)));

    const done = list.filter(i => i.done).length;
    document.getElementById('nrProgressNum').textContent = done;
    document.getElementById('nrProgressTotal').textContent = '/ ' + list.length;
    document.getElementById('nrProgressLabel').textContent =
      done === list.length ? 'all set for tomorrow' : (list.length - done) + ' left';
    document.getElementById('nrCard').classList.toggle('nr-all-done', done === list.length);
  }

  window.NightRoutine = {
    renderNightRoutine: renderNightRoutine
  };

  renderNightRoutine();
})();
