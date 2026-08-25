// =============================================================
// Today / Plan Tomorrow, the goal streak, the daily rollover, and the
// North Star mini card. Also owns the active-day boundary check for the
// whole page — it is the module that has to act on the flip (rollover +
// streak), so the other modules are re-rendered from here rather than
// each running its own clock.
// =============================================================
(function () {
  'use strict';

  const Dash = window.Dash;
  const storeGet = Dash.storeGet;
  const storeSet = Dash.storeSet;
  const storeDelete = Dash.storeDelete;
  const storeListKeys = Dash.storeListKeys;
  const formatDate = Dash.formatDate;
  const getActiveDateString = Dash.getActiveDateString;
  const getTomorrowDateString = Dash.getTomorrowDateString;
  const newTaskId = Dash.newTaskId;
  const makeInlineEdit = Dash.makeInlineEdit;

  function todayKey()    { return 'goals:' + getActiveDateString(); }
  function tomorrowKey() { return 'goals:' + getTomorrowDateString(); }

  function getGoals(key) {
    const g = storeGet(key);
    return Array.isArray(g) ? g : [];
  }
  function setGoals(key, list) { storeSet(key, list); }

  // ---------- rollover: pull undone older goals into today ----------
  function rollover() {
    const todayDateStr = getActiveDateString();
    const todayK = 'goals:' + todayDateStr;
    let today = getGoals(todayK);
    const texts = new Set(today.map(g => g.text));

    storeListKeys('goals:').forEach(k => {
      const dateStr = k.slice('goals:'.length);
      if (dateStr >= todayDateStr) return;
      const old = getGoals(k);
      old.forEach(g => {
        if (!g.done && g.text && !texts.has(g.text)) {
          // Carry the whole goal object forward (id, priority, category,
          // dueTime, notes, etc. — fields todo.html adds) instead of
          // rebuilding a bare {text, done}, which used to silently drop
          // that metadata every time a stale task rolled into today.
          const carried = Object.assign({}, g, { done: false });
          delete carried.doneAt;
          today.push(carried);
          texts.add(g.text);
        }
      });
      storeDelete(k);
    });
    setGoals(todayK, today);
  }

  // ---------- streak ----------
  function loadStreak() {
    const s = storeGet('goal_streak_v1');
    if (s && typeof s.count === 'number') return s;
    return { count: 0, lastProcessedDate: '' };
  }
  function saveStreak(s) { storeSet('goal_streak_v1', s); }

  function processStreak() {
    const s = loadStreak();
    const todayDateStr = getActiveDateString();
    const keys = storeListKeys('goals:')
      .map(k => k.slice('goals:'.length))
      .filter(d => d < todayDateStr)
      .sort();
    keys.forEach(dateStr => {
      if (s.lastProcessedDate && dateStr <= s.lastProcessedDate) return;
      const list = getGoals('goals:' + dateStr);
      if (list.length === 0) { /* don't break the streak on empty days */ }
      else if (list.every(g => g.done)) s.count += 1;
      else s.count = 0;
      s.lastProcessedDate = dateStr;
    });
    saveStreak(s);
  }

  function wireDragReorder(row, listEl, key, reload) {
    row.setAttribute('draggable', 'true');
    row.addEventListener('dragstart', (e) => {
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', row.dataset.idx);
    });
    row.addEventListener('dragover', (e) => {
      e.preventDefault();
      row.classList.add('is-drag-over');
    });
    row.addEventListener('dragleave', () => row.classList.remove('is-drag-over'));
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      row.classList.remove('is-drag-over');
      const from = parseInt(e.dataTransfer.getData('text/plain'), 10);
      const to   = parseInt(row.dataset.idx, 10);
      if (isNaN(from) || isNaN(to) || from === to) return;
      const list = getGoals(key);
      const [moved] = list.splice(from, 1);
      list.splice(to, 0, moved);
      setGoals(key, list);
      reload();
    });
  }

  // ---------- Calendar quick-add ----------
  // Detects a time (and optionally a date) typed directly into a task's own
  // text — e.g. "Dinner with Lachlan and friends 06/09/2026 4:30pm" or just
  // "Call the dentist 3:30pm" — and builds a Google Calendar quick-add link
  // for it. No API/OAuth: just the public calendar.google.com render URL,
  // which opens a pre-filled "create event" page for the user to confirm.
  // No date in the text -> defaults to fallbackDateStr (the day the task
  // itself belongs to), not necessarily today.
  function detectTaskSchedule(text, fallbackDateStr) {
    if (!text) return null;
    // Minutes may be written with a colon (3:30pm) or bare, concatenated
    // straight onto the hour (330pm, 1145am) — two alternatives so both
    // "330" (hour 3 + min 30) and "1145" (hour 11 + min 45) parse correctly.
    const time12 = text.match(/\b(1[0-2]|0?[1-9])(?::([0-5]\d)|([0-5]\d))?\s*(am|pm)\b/i);
    const time24 = !time12 && text.match(/\b([01]\d|2[0-3]):([0-5]\d)\b/);
    if (!time12 && !time24) return null;

    let hour, minute, timeMatchStr;
    if (time12) {
      hour = parseInt(time12[1], 10) % 12;
      const minStr = time12[2] || time12[3];
      minute = minStr ? parseInt(minStr, 10) : 0;
      if (/pm/i.test(time12[4])) hour += 12;
      timeMatchStr = time12[0];
    } else {
      hour = parseInt(time24[1], 10);
      minute = parseInt(time24[2], 10);
      timeMatchStr = time24[0];
    }

    const dateMatch = text.match(/\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/);
    let day, month, year;
    if (dateMatch) {
      day = parseInt(dateMatch[1], 10);
      month = parseInt(dateMatch[2], 10);
      year = parseInt(dateMatch[3], 10);
      if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    } else if (fallbackDateStr) {
      const parts = fallbackDateStr.split('-').map(Number);
      year = parts[0]; month = parts[1]; day = parts[2];
    } else {
      const now = new Date();
      year = now.getFullYear(); month = now.getMonth() + 1; day = now.getDate();
    }

    let title = text.replace(timeMatchStr, '');
    if (dateMatch) title = title.replace(dateMatch[0], '');
    title = title.replace(/\s{2,}/g, ' ').replace(/[\s,-]+$/, '').trim();
    if (!title) title = text.trim();

    return { year: year, month: month, day: day, hour: hour, minute: minute, title: title };
  }
  function googleCalendarUrl(sched, durationMinutes) {
    durationMinutes = durationMinutes || 60;
    const pad = function (n) { return String(n).padStart(2, '0'); };
    const start = new Date(sched.year, sched.month - 1, sched.day, sched.hour, sched.minute);
    const end = new Date(start.getTime() + durationMinutes * 60000);
    const fmt = function (d) {
      return d.getFullYear() + pad(d.getMonth() + 1) + pad(d.getDate()) + 'T' + pad(d.getHours()) + pad(d.getMinutes()) + '00';
    };
    const params = new URLSearchParams({ action: 'TEMPLATE', text: sched.title, dates: fmt(start) + '/' + fmt(end) });
    return 'https://calendar.google.com/calendar/render?' + params.toString();
  }
  function appendCalendarButton(li, text, fallbackDateStr) {
    const sched = detectTaskSchedule(text, fallbackDateStr);
    if (!sched) return;
    const cal = document.createElement('a');
    cal.className = 'cal-add-btn';
    cal.href = googleCalendarUrl(sched);
    cal.target = '_blank';
    cal.rel = 'noopener';
    cal.title = 'Add to Google Calendar';
    cal.setAttribute('aria-label', 'Add to Google Calendar');
    cal.textContent = '📅';
    li.appendChild(cal);
  }
  // The 7-Day Planner's per-day list is its own module (week-planner.js) —
  // expose this so it can reuse the same detection instead of duplicating it.
  window.appendCalendarButton = appendCalendarButton;

  function buildGoalRow(goal, idx, key, readOnly, reload) {
    const li = document.createElement('li');
    li.className = 'gm-row';
    li.dataset.idx = String(idx);
    if (goal.done) li.classList.add('gm-row-done');
    if (goal.queued) li.classList.add('gm-row-queued');

    const handle = document.createElement('span');
    handle.className = 'gm-handle';
    handle.textContent = '⋮⋮';
    li.appendChild(handle);

    const cb = document.createElement('input');
    cb.type = 'checkbox';
    cb.className = 'gm-check';
    cb.checked = !!goal.done;
    if (readOnly) { cb.disabled = true; cb.title = 'Activates at 6 AM tomorrow'; }
    cb.addEventListener('change', () => {
      const list = getGoals(key);
      if (!list[idx]) return;
      list[idx].done = cb.checked;
      if (cb.checked) list[idx].doneAt = Date.now();
      else delete list[idx].doneAt;
      setGoals(key, list);
      reload();
    });
    li.appendChild(cb);

    const text = document.createElement('span');
    text.className = 'gm-text';
    text.textContent = goal.text;
    li.appendChild(text);
    makeInlineEdit(text, idx, () => getGoals(key), (list) => setGoals(key, list), reload);

    const queueBtn = document.createElement('button');
    queueBtn.type = 'button';
    queueBtn.className = 'gm-queue-btn' + (goal.queued ? ' gm-queue-active' : '');
    queueBtn.textContent = '⚡';
    queueBtn.title = 'Queue for productivity window';
    if (readOnly) queueBtn.disabled = true;
    queueBtn.addEventListener('click', () => {
      const list = getGoals(key);
      if (!list[idx]) return;
      list[idx].queued = !list[idx].queued;
      setGoals(key, list);
      li.classList.add('is-queue-flashing');
      setTimeout(reload, 480);
    });
    li.appendChild(queueBtn);

    appendCalendarButton(li, goal.text, key.replace('goals:', ''));

    const del = document.createElement('button');
    del.type = 'button';
    del.className = 'goal-delete';
    del.setAttribute('aria-label', 'Delete goal');
    del.textContent = '×';
    del.addEventListener('click', () => {
      const list = getGoals(key);
      list.splice(idx, 1);
      setGoals(key, list);
      reload();
    });
    li.appendChild(del);

    wireDragReorder(li, null, key, reload);
    return li;
  }

  // ---------- Renderers ----------
  function renderTodayHeader() {
    const goals = getGoals(todayKey());
    const total = goals.length;
    const done  = goals.filter(g => g.done).length;
    document.getElementById('gmProgressNum').textContent   = done;
    document.getElementById('gmProgressTotal').textContent = '/ ' + total;
    const label = document.getElementById('gmProgressLabel');
    if (total === 0)        label.textContent = 'no goals yet';
    else if (done === total) label.textContent = 'all done — solid day';
    else                     label.textContent = 'complete';

    document.getElementById('todayLabel').textContent =
      'Today — ' + formatDate(getActiveDateString());

    const bar = document.getElementById('gmBar');
    bar.innerHTML = '';
    goals.forEach(g => {
      const seg = document.createElement('div');
      seg.className = 'gm-bar-seg' + (g.done ? ' gm-bar-seg-done' : '');
      bar.appendChild(seg);
    });

    const card = document.getElementById('gmCardToday');
    card.classList.toggle('gm-all-done', total > 0 && done === total);

    const pushBtn = document.getElementById('gmPushBtn');
    pushBtn.style.display = (total > 0 && done < total) ? 'block' : 'none';
  }

  function renderStreak() {
    const s = loadStreak();
    document.getElementById('gmStreakNum').textContent = s.count;
    document.getElementById('gmStreak').classList.toggle('gm-streak-active', s.count > 0);
  }

  function renderTomorrowCount() {
    const list = getGoals(tomorrowKey());
    document.getElementById('gmTomorrowCount').textContent = list.length + ' planned';
    document.getElementById('tomorrowLabel').textContent =
      'Plan tomorrow — ' + formatDate(getTomorrowDateString());
  }

  function renderListInto(goals, listEl, emptyEl, key, readOnly) {
    listEl.innerHTML = '';
    emptyEl.style.display = goals.length === 0 ? 'block' : 'none';
    const reload = () => (key === todayKey() ? loadToday() : loadTomorrow());

    const visible = goals.length > 5 ? goals.slice(0, 5) : goals;
    visible.forEach((g, i) => listEl.appendChild(buildGoalRow(g, i, key, readOnly, reload)));

    if (goals.length > 5) {
      let expanded = false;
      const toggle = document.createElement('button');
      toggle.type = 'button';
      toggle.className = 'gm-show-toggle';
      const updateLabel = () => {
        toggle.textContent = expanded ? 'Show less ▴' : ('Show ' + (goals.length - 5) + ' more ▾');
      };
      updateLabel();
      toggle.addEventListener('click', () => {
        expanded = !expanded;
        if (expanded) {
          goals.slice(5).forEach((g, i) => {
            const row = buildGoalRow(g, i + 5, key, readOnly, reload);
            listEl.insertBefore(row, toggle);
          });
        } else {
          Array.from(listEl.querySelectorAll('.gm-row')).slice(5).forEach(r => r.remove());
        }
        updateLabel();
      });
      listEl.appendChild(toggle);
    }

    if (key === todayKey()) renderTodayHeader();
    else                    renderTomorrowCount();
  }

  function loadToday() {
    const goals = getGoals(todayKey());
    renderListInto(goals, document.getElementById('goalList'), document.getElementById('emptyState'), todayKey(), false);
  }
  function loadTomorrow() {
    const goals = getGoals(tomorrowKey());
    renderListInto(goals, document.getElementById('tomorrowList'), document.getElementById('tomorrowEmpty'), tomorrowKey(), true);
  }

  // ---------- Push remaining ----------
  document.getElementById('gmPushBtn').addEventListener('click', () => {
    const today    = getGoals(todayKey());
    const remaining = today.filter(g => !g.done);
    if (remaining.length === 0) return;
    if (!confirm('Move ' + remaining.length + ' unchecked goal' + (remaining.length === 1 ? '' : 's') + ' to tomorrow?')) return;
    const tomorrow = getGoals(tomorrowKey());
    const seen = new Set(tomorrow.map(g => g.text));
    remaining.forEach(g => {
      if (seen.has(g.text)) return;
      // Carry the whole task forward (id/priority/category/notes/etc.),
      // same as rollover() does for stale undone goals — not a fresh
      // bare {text,done} that drops everything todo.html added.
      const carried = Object.assign({}, g, { done: false });
      delete carried.doneAt;
      tomorrow.push(carried);
      seen.add(g.text);
    });
    setGoals(tomorrowKey(), tomorrow);
    setGoals(todayKey(), today.filter(g => g.done));
    loadToday(); loadTomorrow();
  });

  // ---------- Add + Polish handlers ----------
  function showStatus(el, message, isError) {
    el.textContent = message;
    el.classList.toggle('gm-status-error', !!isError);
    clearTimeout(el._t);
    el._t = setTimeout(() => { el.textContent = ''; el.classList.remove('gm-status-error'); }, 3500);
  }

  async function polishOne(text) {
    const res = await fetch('/api/claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'polish', input: text })
    });
    if (!res.ok) throw new Error('polish request failed');
    const data = await res.json();
    if (!data || typeof data.text !== 'string' || !data.text.trim()) throw new Error('bad response');
    return data.text.trim();
  }

  function makeAddHandlers(input, addBtn, polishBtn, key, statusEl, reload) {
    function plainAdd(text) {
      const list = getGoals(key);
      // Same shape todo.html's addTask() builds — id/priority/category/
      // createdAt included from the moment of creation, so a task added
      // here (Today or Plan Tomorrow) is already a full-fledged todo.html
      // task rather than a bare {text,done} it has to patch up later.
      list.push({
        id: newTaskId(), text, done: false,
        priority: 'medium', category: 'other',
        createdAt: Date.now()
      });
      setGoals(key, list);
      input.value = '';
      reload();
    }
    addBtn.addEventListener('click', () => {
      const text = input.value.trim();
      if (!text) return;
      plainAdd(text);
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addBtn.click(); }
    });
    polishBtn.addEventListener('click', async () => {
      const text = input.value.trim();
      if (!text) return;
      polishBtn.disabled = true;
      try {
        const polished = await polishOne(text);
        plainAdd(polished);
      } catch (e) {
        plainAdd(text);
        showStatus(statusEl, 'Polish failed — added as-typed.', true);
      } finally {
        polishBtn.disabled = false;
      }
    });
  }

  makeAddHandlers(
    document.getElementById('goalInput'),
    document.getElementById('goalAddBtn'),
    document.getElementById('goalPolishBtn'),
    todayKey(),
    document.getElementById('polishStatus'),
    loadToday
  );
  makeAddHandlers(
    document.getElementById('tomorrowInput'),
    document.getElementById('tomorrowAddBtn'),
    document.getElementById('tomorrowPolishBtn'),
    tomorrowKey(),
    document.getElementById('tomorrowStatus'),
    loadTomorrow
  );

  // ---------- North Star (compact) + Your Goals preview ----------
  // Both read goals-data.js directly rather than computing their own
  // percentages — GD.computeOverallProgress()/GD.computeProgress() are
  // the exact same functions goals.html's full page renders from, so
  // there is exactly one place goal-progress math can live.
  function renderNorthStarMini() {
    const GD = window.GoalsData;
    if (!GD) return;
    const ns = GD.getNorthStar();
    document.getElementById('nsMiniStatement').textContent = ns.statement;
    document.getElementById('nsMiniPillars').textContent = (ns.pillars || []).join(' · ');
    const pct = GD.computeOverallProgress();
    document.getElementById('nsMiniPct').textContent = pct + '%';
    document.getElementById('nsMiniFill').style.width = pct + '%';
  }

  // Kept as the single name event listeners call — main.html only shows
  // the North Star card now (the "Your Goals" preview list lives on
  // goals.html only), but this indirection means adding another
  // main.html-only summary widget later doesn't mean touching every
  // call site again.
  function renderGoalsSummary() {
    renderNorthStarMini();
  }

  function renderNightSleep() {
    const NS = window.NightSleep;
    if (!NS) return;
    NS.renderNightRoutine();
    NS.renderSleep();
  }

  // Detects the active day flipping (the 6 AM boundary, or just plain
  // midnight rollovers) while the tab is left open and never touched —
  // without this, Today/Tomorrow/Night Routine/Sleep would all keep
  // showing the day that was "today" when the page loaded until the
  // user reloads or edits something. goals:<tomorrow-date> already
  // *is* goals:<the-new-active-date> once this flips (see
  // getTomorrowDateString()/getActiveDateString()) — nothing else
  // has to move the data, this just makes the open tab notice and
  // re-render against it.
  let lastActiveDate = getActiveDateString();
  function checkDayBoundary() {
    const current = getActiveDateString();
    if (current === lastActiveDate) return;
    lastActiveDate = current;
    rollover();
    processStreak();
    loadToday();
    loadTomorrow();
    renderStreak();
    renderNightSleep();
  }

  // ---------- Boot ----------
  rollover();
  processStreak();
  loadToday();
  loadTomorrow();
  renderStreak();
  setInterval(checkDayBoundary, 60 * 1000);
  renderGoalsSummary();

  // Re-render when storage changes from another tab (or our bridged parent).
  window.addEventListener('storage', () => {
    loadToday(); loadTomorrow(); renderStreak(); renderNightSleep(); renderGoalsSummary();
  });
  // Same-tab sibling views (the 7-Day Overview's own To Do List below, or
  // todo.html when embedded/bridged) write through storeSet/setGoals, which
  // dispatches this instead of a native 'storage' event (that only fires in
  // *other* tabs) — without this, editing today's/tomorrow's goals from the
  // 7-Day Overview panel wouldn't refresh these two cards until reload.
  window.addEventListener('goals-changed', () => {
    loadToday(); loadTomorrow(); renderNorthStarMini();
  });
  // strategic:* writes (goals.html, or a milestone linked to a task here)
  // dispatch this instead — same-tab equivalent of the storage event above.
  window.addEventListener('strategic-goals-changed', renderGoalsSummary);
})();
