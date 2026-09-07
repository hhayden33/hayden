// =============================================================
// Generic add/toggle/delete list, backed by one localStorage key holding
// an array of { id, text, done, status, createdAt }. Powers every Work
// module page (Tasks, Jobs Applied, Applications, Performance, Notes)
// so each one isn't a hand-rolled copy of the same CRUD loop —
// they differ only in storage key, copy, and whether items carry a
// done checkbox and/or a cycling status pill.
//
// Reuses main.css's existing .gm-card / .goal-list.gm-list / .gm-row /
// .gm-check / .gm-text / .goal-delete / .gm-input / .gm-add /
// .empty-state classes (already loaded by every page that includes
// this file) rather than inventing parallel styling, so Work reads as
// the same system as Life, not a reskin.
//
// Usage:
//   initSimpleList({
//     storageKey: 'work:tasks:v1',
//     listEl, inputEl, addBtn, emptyEl,
//     useDone: true,                    // show a checkbox (default true)
//     statuses: ['Applied','Interview'] // omit for no status pill
//   });
// =============================================================
(function () {
  'use strict';

  function storeGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function storeSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    window.dispatchEvent(new Event('storage'));
  }
  function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }

  function initSimpleList(opts) {
    const storageKey = opts.storageKey;
    const listEl = opts.listEl;
    const emptyEl = opts.emptyEl;
    const useDone = opts.useDone !== false;
    const statuses = opts.statuses || null;

    function getItems() { return storeGet(storageKey) || []; }
    function setItems(items) { storeSet(storageKey, items); }

    function buildRow(item, idx, items) {
      const li = document.createElement('li');
      li.className = 'gm-row' + (item.done ? ' gm-row-done' : '');

      if (useDone) {
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'gm-check';
        cb.checked = !!item.done;
        cb.addEventListener('change', function () {
          const list = getItems();
          if (!list[idx]) return;
          list[idx].done = cb.checked;
          setItems(list);
          render();
        });
        li.appendChild(cb);
      }

      const text = document.createElement('span');
      text.className = 'gm-text';
      text.textContent = item.text;
      li.appendChild(text);

      if (statuses && statuses.length) {
        const pill = document.createElement('button');
        pill.type = 'button';
        pill.className = 'sl-status-pill';
        pill.textContent = item.status || statuses[0];
        pill.title = 'Click to change status';
        pill.addEventListener('click', function () {
          const list = getItems();
          if (!list[idx]) return;
          const cur = statuses.indexOf(list[idx].status);
          list[idx].status = statuses[(cur + 1) % statuses.length];
          setItems(list);
          render();
        });
        li.appendChild(pill);
      }

      const del = document.createElement('button');
      del.type = 'button';
      del.className = 'goal-delete';
      del.setAttribute('aria-label', 'Delete');
      del.textContent = '×';
      del.addEventListener('click', function () {
        const list = getItems();
        list.splice(idx, 1);
        setItems(list);
        render();
      });
      li.appendChild(del);

      return li;
    }

    function render() {
      const items = getItems();
      listEl.innerHTML = '';
      if (!items.length) {
        if (emptyEl) emptyEl.style.display = '';
        return;
      }
      if (emptyEl) emptyEl.style.display = 'none';
      items.forEach(function (item, idx) {
        listEl.appendChild(buildRow(item, idx, items));
      });
    }

    function addItem() {
      const val = (opts.inputEl.value || '').trim();
      if (!val) return;
      const items = getItems();
      items.push({ id: newId(), text: val, done: false, status: statuses ? statuses[0] : undefined, createdAt: Date.now() });
      setItems(items);
      opts.inputEl.value = '';
      render();
    }

    if (opts.addBtn) opts.addBtn.addEventListener('click', addItem);
    if (opts.inputEl) {
      opts.inputEl.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') addItem();
      });
    }

    render();
    window.addEventListener('storage', render);
  }

  window.initSimpleList = initSimpleList;
})();
