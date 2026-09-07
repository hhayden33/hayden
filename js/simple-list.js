// =============================================================
// Generic add/toggle/delete list, backed by one localStorage key holding
// an array of { id, text, done, status, createdAt }. Powers every Work
// module page (Tasks, Jobs Applied, Applications, Notes) so each one
// isn't a hand-rolled copy of the same CRUD loop — they differ only in
// storage key, copy, and a handful of optional behaviours:
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
//     useDone: true,                     // show a checkbox (default true)
//     statuses: ['Applied','Interview'], // omit for no status control
//     statusUi: 'pill',                  // 'pill' (cycle, default) |
//                                         // 'dropdown' (free choice) |
//                                         // 'stage' (forward-only + push button)
//     editable: true,                    // click text to edit in place
//     showTimestamp: true,               // relative "createdAt" next to text
//     searchInputEl: el                  // optional — filters the list live
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

  function formatRelative(ts) {
    if (!ts) return '';
    const diffMin = Math.floor((Date.now() - ts) / 60000);
    if (diffMin < 1) return 'Just now';
    if (diffMin < 60) return diffMin + 'm ago';
    const hr = Math.floor(diffMin / 60);
    if (hr < 24) return hr + 'h ago';
    const day = Math.floor(hr / 24);
    if (day < 7) return day + 'd ago';
    return new Date(ts).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });
  }

  function initSimpleList(opts) {
    const storageKey = opts.storageKey;
    const listEl = opts.listEl;
    const emptyEl = opts.emptyEl;
    const useDone = opts.useDone !== false;
    const statuses = opts.statuses || null;
    const statusUi = opts.statusUi || 'pill';
    const editable = !!opts.editable;
    const showTimestamp = !!opts.showTimestamp;
    const searchInputEl = opts.searchInputEl || null;

    function getItems() { return storeGet(storageKey) || []; }
    function setItems(items) { storeSet(storageKey, items); }

    function saveText(idx, val) {
      const list = getItems();
      if (!list[idx]) return;
      if (!val) { list.splice(idx, 1); setItems(list); render(); return; }
      list[idx].text = val;
      setItems(list);
    }

    function buildStatusControl(li, item, idx) {
      if (!statuses || !statuses.length) return;

      if (statusUi === 'dropdown') {
        const select = document.createElement('select');
        select.className = 'sl-status-select';
        statuses.forEach(function (s) {
          const opt = document.createElement('option');
          opt.value = s;
          opt.textContent = s;
          if ((item.status || statuses[0]) === s) opt.selected = true;
          select.appendChild(opt);
        });
        select.addEventListener('change', function () {
          const list = getItems();
          if (!list[idx]) return;
          list[idx].status = select.value;
          setItems(list);
          render();
        });
        li.appendChild(select);
        return;
      }

      if (statusUi === 'stage') {
        const wrap = document.createElement('span');
        wrap.className = 'sl-stage-wrap';
        const curIdx = Math.max(0, statuses.indexOf(item.status || statuses[0]));
        const label = document.createElement('span');
        label.className = 'sl-stage-label';
        label.textContent = (item.status || statuses[0]) + ' (' + (curIdx + 1) + '/' + statuses.length + ')';
        wrap.appendChild(label);
        if (curIdx < statuses.length - 1) {
          const push = document.createElement('button');
          push.type = 'button';
          push.className = 'sl-stage-push';
          push.textContent = 'Push to next stage →';
          push.addEventListener('click', function () {
            const list = getItems();
            if (!list[idx]) return;
            const ci = Math.max(0, statuses.indexOf(list[idx].status || statuses[0]));
            list[idx].status = statuses[Math.min(ci + 1, statuses.length - 1)];
            setItems(list);
            render();
          });
          wrap.appendChild(push);
        }
        li.appendChild(wrap);
        return;
      }

      // 'pill' — click to cycle through statuses in order
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

    function buildRow(item, idx) {
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

      const textWrap = document.createElement('span');
      textWrap.style.flex = '1';
      textWrap.style.minWidth = '0';

      const text = document.createElement('span');
      text.className = 'gm-text';
      text.textContent = item.text;
      textWrap.appendChild(text);

      if (showTimestamp && item.createdAt) {
        const ts = document.createElement('span');
        ts.className = 'sl-timestamp';
        ts.textContent = formatRelative(item.createdAt);
        textWrap.appendChild(ts);
      }
      li.appendChild(textWrap);

      if (editable) {
        text.title = 'Click to edit';
        text.addEventListener('click', function () {
          if (text.isContentEditable) return;
          text.contentEditable = 'true';
          text.focus();
          const range = document.createRange();
          range.selectNodeContents(text);
          range.collapse(false);
          const sel = window.getSelection();
          sel.removeAllRanges();
          sel.addRange(range);
        });
        text.addEventListener('blur', function () {
          text.contentEditable = 'false';
          saveText(idx, text.textContent.trim());
        });
        text.addEventListener('keydown', function (e) {
          if (e.key === 'Enter') { e.preventDefault(); text.blur(); }
        });
      }

      buildStatusControl(li, item, idx);

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
      const term = searchInputEl ? searchInputEl.value.trim().toLowerCase() : '';
      const visible = term ? items.filter(function (it) { return it.text.toLowerCase().indexOf(term) !== -1; }) : items;

      listEl.innerHTML = '';
      if (!items.length) {
        if (emptyEl) { emptyEl.style.display = ''; emptyEl.textContent = emptyEl.dataset.defaultText || emptyEl.textContent; }
        return;
      }
      if (!visible.length) {
        if (emptyEl) { emptyEl.dataset.defaultText = emptyEl.dataset.defaultText || emptyEl.textContent; emptyEl.style.display = ''; emptyEl.textContent = 'No notes match your search.'; }
        return;
      }
      if (emptyEl) emptyEl.style.display = 'none';
      visible.forEach(function (item) {
        const idx = items.indexOf(item);
        listEl.appendChild(buildRow(item, idx));
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
    if (searchInputEl) searchInputEl.addEventListener('input', render);

    render();
    window.addEventListener('storage', render);
  }

  window.initSimpleList = initSimpleList;
})();
