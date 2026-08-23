// =================================================================
// GOALS DATA LAYER — shared by goals.html (and, later, any other page
// that wants to read/write strategic goals or milestones).
//
// Storage: a small, distinct localStorage namespace —
//   strategic:northstar   -> { statement, pillars[], progressOverride }
//   strategic:goals       -> [ Goal, ... ]
//   strategic:milestones  -> [ Milestone, ... ]
// Deliberately NOT 'goal:' or 'goals:' — the existing To-Do system
// already owns every 'goals:<YYYY-MM-DD>' key (see todo.html/main.html),
// and a near-miss prefix here would either collide or just be
// confusing to read next to it. 'strategic:' keeps this fully
// separate while still living in the same localStorage the rest of
// the dashboard uses — no new persistence system.
//
// Milestones link to the To-Do system through *that same* 'goals:'
// store: createTaskFromMilestone() pushes a normal task object (same
// shape todo.html's addTask() creates) onto the right date's
// 'goals:<date>' array, plus two extra fields (milestoneId, goalId)
// that todo.html/main.html simply ignore — exactly the same pattern
// already used for todo.html's own priority/category/dueTime fields
// layered onto main.html's original {text, done} shape. One task
// store, read by three pages.
//
// Evidence readers (GoalsData.Evidence.*) are read-only lookups into
// each source page's OWN localStorage keys (run:*, po_coach_v1,
// po_water_v1, nw:history) — goals.html never writes to those, and
// this file never duplicates their data into its own keys. If a
// source page has never been used, the reader returns null so the
// caller can show "Manual" instead of a fabricated live value.
// =================================================================
(function (global) {
  'use strict';

  var NS = 'strategic:';
  var K_NORTHSTAR  = NS + 'northstar';
  var K_GOALS      = NS + 'goals';
  var K_MILESTONES = NS + 'milestones';

  function storeGet(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (raw == null) return fallback;
      var v = JSON.parse(raw);
      return v == null ? fallback : v;
    } catch (e) { return fallback; }
  }
  function storeSet(key, value) {
    localStorage.setItem(key, JSON.stringify(value));
    global.dispatchEvent(new CustomEvent('strategic-goals-changed'));
  }
  function pad2(n) { return String(n).padStart(2, '0'); }
  function todayKeyStr() {
    var d = new Date();
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }
  function newId(prefix) {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  // ---------------------------------------------------------------
  // North Star
  // ---------------------------------------------------------------
  function defaultNorthStar() {
    return {
      statement: "Build a life I'm proud of.",
      pillars: ['Health', 'Wealth', 'Career', 'Business', 'Experiences'],
      progressOverride: null
    };
  }
  function getNorthStar() {
    return Object.assign(defaultNorthStar(), storeGet(K_NORTHSTAR, {}));
  }
  function setNorthStar(ns) { storeSet(K_NORTHSTAR, ns); }

  // ---------------------------------------------------------------
  // Goals — getGoals() returns null (not []) when never seeded, so
  // goals.html can tell "first run, seed sample data" apart from
  // "user deleted everything on purpose".
  // ---------------------------------------------------------------
  function getGoals() {
    var g = storeGet(K_GOALS, null);
    return Array.isArray(g) ? g : null;
  }
  function setGoals(list) { storeSet(K_GOALS, list); }
  function addGoal(data) {
    var list = getGoals() || [];
    var g = Object.assign({ id: newId('g_'), createdAt: Date.now(), archived: false }, data);
    list.push(g);
    setGoals(list);
    return g;
  }
  function patchGoal(id, patch) {
    var list = getGoals() || [];
    var idx = list.findIndex(function (g) { return g.id === id; });
    if (idx === -1) return null;
    list[idx] = Object.assign({}, list[idx], patch);
    setGoals(list);
    return list[idx];
  }
  function deleteGoal(id) {
    setGoals((getGoals() || []).filter(function (g) { return g.id !== id; }));
    setMilestones((getMilestones() || []).filter(function (m) { return m.goalId !== id; }));
  }

  // ---------------------------------------------------------------
  // Milestones
  // ---------------------------------------------------------------
  function getMilestones() {
    var m = storeGet(K_MILESTONES, null);
    return Array.isArray(m) ? m : null;
  }
  function setMilestones(list) { storeSet(K_MILESTONES, list); }
  function addMilestone(data) {
    var list = getMilestones() || [];
    var m = Object.assign({
      id: newId('m_'), done: false, doneAt: null,
      linkedTaskId: null, linkedTaskDate: null, createdAt: Date.now()
    }, data);
    list.push(m);
    setMilestones(list);
    return m;
  }
  function patchMilestone(id, patch) {
    var list = getMilestones() || [];
    var idx = list.findIndex(function (m) { return m.id === id; });
    if (idx === -1) return null;
    list[idx] = Object.assign({}, list[idx], patch);
    setMilestones(list);
    return list[idx];
  }
  function deleteMilestone(id) {
    setMilestones((getMilestones() || []).filter(function (m) { return m.id !== id; }));
  }
  function milestonesForGoal(goalId) {
    return (getMilestones() || []).filter(function (m) { return m.goalId === goalId; });
  }

  // ---------------------------------------------------------------
  // To-Do linking — reads/writes the SAME 'goals:<date>' store
  // todo.html and main.html already own. No second task system.
  // ---------------------------------------------------------------
  function newTaskId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function createTaskFromMilestone(milestone, opts) {
    opts = opts || {};
    var dateStr = opts.date || milestone.date || todayKeyStr();
    var key = 'goals:' + dateStr;
    var list = storeGet(key, []);
    var task = {
      id: newTaskId(),
      text: milestone.title,
      done: false,
      priority: opts.priority || 'medium',
      category: opts.category || 'goals',
      createdAt: Date.now(),
      // The two fields todo.html/main.html don't know about and simply
      // carry along untouched — this is what makes a task "belong" to
      // a milestone/goal without a second store.
      milestoneId: milestone.id,
      goalId: milestone.goalId
    };
    list.push(task);
    localStorage.setItem(key, JSON.stringify(list));
    global.dispatchEvent(new CustomEvent('goals-changed'));
    patchMilestone(milestone.id, { linkedTaskId: task.id, linkedTaskDate: dateStr });
    return task;
  }

  function listAllTaskDateKeys() {
    var out = [];
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (k && k.indexOf('goals:') === 0) out.push(k);
    }
    return out;
  }

  function findTaskById(taskId) {
    var keys = listAllTaskDateKeys();
    for (var i = 0; i < keys.length; i++) {
      var list = storeGet(keys[i], []);
      var idx = list.findIndex(function (t) { return t.id === taskId; });
      if (idx !== -1) return { dateKey: keys[i], list: list, idx: idx, task: list[idx] };
    }
    return null;
  }

  // Milestone -> linked task's current done state (or null if unlinked
  // / the task was deleted from todo.html since).
  function linkedTaskDone(milestone) {
    if (!milestone.linkedTaskId) return null;
    var found = findTaskById(milestone.linkedTaskId);
    return found ? !!found.task.done : null;
  }

  // Push a milestone's own done state onto its linked task (milestone
  // -> todo direction of the two-way sync).
  function syncLinkedTaskDone(milestone, done) {
    if (!milestone.linkedTaskId) return;
    var found = findTaskById(milestone.linkedTaskId);
    if (!found || !!found.task.done === done) return;
    found.list[found.idx] = Object.assign({}, found.task, { done: done, doneAt: done ? Date.now() : undefined });
    localStorage.setItem(found.dateKey, JSON.stringify(found.list));
    global.dispatchEvent(new CustomEvent('goals-changed'));
  }

  // All todo tasks tagged with a given goalId, across every date —
  // used for goal-level "N/M linked tasks done" rollups.
  function allTasksForGoal(goalId) {
    var out = [];
    listAllTaskDateKeys().forEach(function (k) {
      storeGet(k, []).forEach(function (t) { if (t.goalId === goalId) out.push(t); });
    });
    return out;
  }

  // ---------------------------------------------------------------
  // Evidence readers — read-only lookups into each source page's own
  // localStorage. Every function returns null when that page has
  // never been used on this device, so the UI can say "Manual" rather
  // than show a fabricated 0.
  // ---------------------------------------------------------------
  function trailingDayKeys(n) {
    var out = [], now = new Date();
    for (var i = 0; i < n; i++) {
      var d = new Date(now); d.setDate(d.getDate() - i);
      out.push(d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()));
    }
    return out;
  }

  var Evidence = {
    // running.html — run:goal / run:pbs / run:runs
    running: function () {
      var goal = storeGet('run:goal', null);
      var pbs = storeGet('run:pbs', null);
      var runs = storeGet('run:runs', []);
      if (!goal && !pbs && (!runs || !runs.length)) return null;
      var weekDistanceKm = 0;
      if (Array.isArray(runs) && runs.length) {
        var monday = new Date();
        var day = monday.getDay();
        monday.setDate(monday.getDate() + (day === 0 ? -6 : 1 - day));
        monday.setHours(0, 0, 0, 0);
        var mondayKey = monday.getFullYear() + '-' + pad2(monday.getMonth() + 1) + '-' + pad2(monday.getDate());
        runs.forEach(function (r) {
          if (r.date >= mondayKey) weekDistanceKm += (r.distanceKm || 0);
        });
      }
      return { goal: goal, pbs: pbs, runsLogged: (runs || []).length, weekDistanceKm: weekDistanceKm };
    },
    // gym.html — po_coach_workout_done (bespoke sync, not sync.js, but
    // same localStorage/app_state pattern)
    fitness: function () {
      var doneDays = storeGet('po_coach_workout_done', null);
      if (!doneDays) return null;
      var sessionsLast7Days = 0;
      trailingDayKeys(7).forEach(function (k) { if (doneDays[k]) sessionsLast7Days++; });
      return { sessionsLast7Days: sessionsLast7Days };
    },
    // po-water.html — po_water_v1
    water: function () {
      var w = storeGet('po_water_v1', null);
      if (!w) return null;
      var todayKey = todayKeyStr();
      var servings = (w.logs && w.logs[todayKey]) || 0;
      var unit = w.unit || 'bottle';
      var unitMl = unit === 'bottle' ? (w.bottleMl || 500) : unit === 'glass' ? (w.glassMl || 250) : unit === 'oz' ? 30 : 1;
      return { todayMl: servings * unitMl, unit: unit };
    },
    // finance.html — nw:history (best), falls back to summing nw:bank/
    // stocks/crypto/other if no snapshot has been logged yet
    finance: function () {
      var hist = storeGet('nw:history', null);
      if (Array.isArray(hist) && hist.length) {
        var last = hist[hist.length - 1];
        return { currentTotal: last.v, asOf: last.t };
      }
      var cats = ['nw:bank', 'nw:stocks', 'nw:crypto', 'nw:other'];
      var sum = 0, any = false;
      cats.forEach(function (k) {
        var arr = storeGet(k, null);
        if (Array.isArray(arr)) {
          any = true;
          arr.forEach(function (it) { sum += Number(it.amount) || 0; });
        }
      });
      return any ? { currentTotal: sum, asOf: null } : null;
    }
  };

  global.GoalsData = {
    getNorthStar: getNorthStar, setNorthStar: setNorthStar,
    getGoals: getGoals, setGoals: setGoals, addGoal: addGoal, patchGoal: patchGoal, deleteGoal: deleteGoal,
    getMilestones: getMilestones, setMilestones: setMilestones, addMilestone: addMilestone,
    patchMilestone: patchMilestone, deleteMilestone: deleteMilestone, milestonesForGoal: milestonesForGoal,
    createTaskFromMilestone: createTaskFromMilestone, findTaskById: findTaskById,
    linkedTaskDone: linkedTaskDone, syncLinkedTaskDone: syncLinkedTaskDone, allTasksForGoal: allTasksForGoal,
    Evidence: Evidence,
    newId: newId, todayKeyStr: todayKeyStr
  };
})(window);
