// =============================================================
// Shared primitives for main.html's modules. These used to be private
// to the one giant IIFE that held goals + night routine + sleep + the
// day ring; splitting that file meant the storage wrapper, the 6 AM
// active-day boundary, and the inline-edit binding all needed a single
// home rather than three copies that could drift apart.
//
// Deliberately not a general-purpose utility bag — only what more than
// one module on this page actually reads.
// =============================================================
(function () {
  'use strict';

  // ---------- storage helpers ----------
  function storeGet(key) {
    try { return JSON.parse(localStorage.getItem(key)); } catch (e) { return null; }
  }
  function storeSet(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
    if (typeof key === 'string' && key.indexOf('goals:') === 0) {
      window.dispatchEvent(new CustomEvent('goals-changed'));
    }
  }
  function storeDelete(key) { try { localStorage.removeItem(key); } catch (e) {} }
  function storeListKeys(prefix) {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.indexOf(prefix) === 0) out.push(k);
    }
    return out;
  }

  // ---------- date helpers ----------
  function pad2(n) { return String(n).padStart(2, '0'); }
  function dateToKey(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function getActiveDateString() {
    const now = new Date();
    if (now.getHours() < 6) {
      const d = new Date(now);
      d.setDate(d.getDate() - 1);
      return dateToKey(d);
    }
    return dateToKey(now);
  }
  function getTomorrowDateString() {
    const now = new Date();
    const d = new Date(now);
    if (now.getHours() >= 6) d.setDate(d.getDate() + 1);
    return dateToKey(d);
  }
  function formatDate(yyyy_mm_dd) {
    const parts = yyyy_mm_dd.split('-').map(Number);
    const d = new Date(parts[0], parts[1] - 1, parts[2]);
    const wk = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][d.getDay()];
    const mo = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()];
    return wk + ', ' + mo + ' ' + d.getDate();
  }

  // Same id scheme todo.html's newId() uses — a task created here already
  // carries a real id instead of relying on todo.html's lazy id-backfill
  // (getGoals() there assigns one the first time it reads an id-less task).
  function newTaskId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // getList/setList let this be reused for any {text, ...}[] localStorage
  // list keyed by idx — both the goals:<date> lists (via getGoals/setGoals)
  // and the nightroutine:<date> list (via getNightRoutine/setNightRoutine)
  // share this exact same edit-in-place shape.
  function makeInlineEdit(textEl, idx, getList, setList, reload) {
    textEl.addEventListener('click', () => {
      if (textEl.getAttribute('contenteditable') === 'true') return;
      const original = textEl.textContent;
      textEl.setAttribute('contenteditable', 'true');
      textEl.focus();
      const range = document.createRange();
      range.selectNodeContents(textEl);
      range.collapse(false);
      const sel = window.getSelection();
      sel.removeAllRanges(); sel.addRange(range);

      function commit() {
        const next = textEl.textContent.trim();
        textEl.removeAttribute('contenteditable');
        if (next && next !== original) {
          const list = getList();
          if (list[idx]) { list[idx].text = next; setList(list); }
          reload();
        } else {
          textEl.textContent = original;
        }
      }
      function cancel() {
        textEl.removeAttribute('contenteditable');
        textEl.textContent = original;
      }
      textEl.addEventListener('blur', commit, { once: true });
      textEl.addEventListener('keydown', function onKey(e) {
        if (e.key === 'Enter') { e.preventDefault(); textEl.removeEventListener('keydown', onKey); textEl.blur(); }
        else if (e.key === 'Escape') { e.preventDefault(); textEl.removeEventListener('keydown', onKey); cancel(); }
      });
    });
  }

  window.Dash = {
    storeGet: storeGet,
    storeSet: storeSet,
    storeDelete: storeDelete,
    storeListKeys: storeListKeys,
    pad2: pad2,
    dateToKey: dateToKey,
    getActiveDateString: getActiveDateString,
    getTomorrowDateString: getTomorrowDateString,
    formatDate: formatDate,
    newTaskId: newTaskId,
    makeInlineEdit: makeInlineEdit
  };
})();
