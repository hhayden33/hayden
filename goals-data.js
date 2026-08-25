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
  function ymd(d) { return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function mondayOf(date) {
    var d = new Date(date);
    var day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    d.setHours(0, 0, 0, 0);
    return d;
  }
  // Same ISO-week algorithm main.html uses for its 'weekplan:<ISO-week>'
  // keys — duplicated here (not imported) since main.html has no shared
  // module to pull from, but it's pure date math, not business logic.
  function isoWeekKey(date) {
    var d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    var dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    var yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    var weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return d.getUTCFullYear() + '-W' + pad2(weekNo);
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
    // same localStorage/app_state pattern) crossed with main.html's own
    // 'weekplan:<ISO-week>' split assignments, so a "session" only counts
    // toward a split type if that day was both planned as that split AND
    // marked done in the gym coach.
    fitness: function () {
      var doneDays = storeGet('po_coach_workout_done', null);
      if (!doneDays) return null;
      var sessionsLast7Days = 0;
      trailingDayKeys(7).forEach(function (k) { if (doneDays[k]) sessionsLast7Days++; });

      var REQUIRED_SPLITS = ['push', 'pull', 'legs', 'full'];
      function splitsForDate(dateKey) {
        var d = new Date(dateKey + 'T00:00:00');
        if (isNaN(d)) return [];
        var plan = storeGet('weekplan:' + isoWeekKey(mondayOf(d)), null);
        var v = plan && plan[dateKey];
        if (!v) return [];
        return Array.isArray(v) ? v : [v];
      }
      function typesDoneForWeek(monday) {
        var found = {};
        for (var i = 0; i < 7; i++) {
          var d = new Date(monday); d.setDate(d.getDate() + i);
          var dk = ymd(d);
          if (!doneDays[dk]) continue;
          splitsForDate(dk).forEach(function (s) { if (REQUIRED_SPLITS.indexOf(s) !== -1) found[s] = true; });
        }
        return Object.keys(found);
      }

      var thisMonday = mondayOf(new Date());
      var weekTypesDone = typesDoneForWeek(thisMonday);

      // Streak of consecutive fully-complete weeks (all 4 splits done).
      // The current week only joins the streak once it's actually
      // complete — being mid-week and not done yet doesn't break it,
      // it just isn't counted until it is.
      var streakWeeks = weekTypesDone.length >= REQUIRED_SPLITS.length ? 1 : 0;
      var cursor = new Date(thisMonday);
      cursor.setDate(cursor.getDate() - 7);
      for (var w = 0; w < 208; w++) {
        if (typesDoneForWeek(cursor).length >= REQUIRED_SPLITS.length) {
          streakWeeks++;
          cursor.setDate(cursor.getDate() - 7);
        } else break;
      }

      return {
        sessionsLast7Days: sessionsLast7Days,
        weekTypesDone: weekTypesDone,
        weekTypesRequired: REQUIRED_SPLITS,
        streakWeeks: streakWeeks
      };
    },
    // po-water.html — po_water_v1. Target mirrors the coach's own manual
    // target (its default mode) so the goal never drifts out of sync with
    // what the live widget on main.html shows; auto/calculated-target mode
    // runs a personalized weight/activity/substance formula that lives
    // entirely in po-water.html, so that mode falls back to the goal's own
    // manualTarget rather than duplicating that calculator here.
    water: function () {
      var w = storeGet('po_water_v1', null);
      if (!w) return null;
      var todayKey = todayKeyStr();
      var servings = (w.logs && w.logs[todayKey]) || 0;
      var unit = w.unit || 'bottle';
      var unitMl = unit === 'bottle' ? (w.bottleMl || 500) : unit === 'glass' ? (w.glassMl || 250) : unit === 'oz' ? 30 : 1;
      var targetMl = (w.useManualTarget && w.manualTargetMl) ? w.manualTargetMl : null;
      return { todayMl: servings * unitMl, unit: unit, targetMl: targetMl };
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

  // ---------------------------------------------------------------
  // Category system + progress computation — the single place both
  // goals.html and any preview (main.html) get a goal's percentage
  // from. Neither page is allowed its own copy of this logic: it's
  // the whole point of "single source of truth" here — a currency
  // goal's math, a time goal's (lower-is-better) math, a milestone
  // goal's math, all live in exactly one place.
  // ---------------------------------------------------------------
  // 'weekly'/'daily' goals are recurring practices with no finish line
  // (train consistently, drink water) rather than outcomes with an end
  // state — they get their own section on goals.html and are excluded
  // from the North Star average below, so a habit you're already doing
  // every week doesn't quietly dilute (or inflate) how "done" your real
  // goals are. isHabit() is the one place this distinction is made, so
  // goals.html never has to duplicate the type list.
  function isHabit(goal) { return goal.type === 'weekly' || goal.type === 'daily'; }

  var WEIGHT_META = {
    1: { label: 'Low' },
    2: { label: 'Medium' },
    3: { label: 'High' }
  };
  var DEFAULT_WEIGHT = 2;

  var CATEGORY_META = {
    health:      { label: 'Health',      icon: '❤️',  color: '#20A5A0' },
    wealth:      { label: 'Wealth',      icon: '💰', color: '#6F4AA8' },
    career:      { label: 'Career',      icon: '💼', color: '#087CA3' },
    business:    { label: 'Business',    icon: '🚀', color: '#A98BCB' },
    experiences: { label: 'Experiences', icon: '🌤️', color: '#D8C9E8' },
    personal:    { label: 'Personal',    icon: '🌱', color: '#B98AE0' }
  };
  var CATEGORY_ORDER = ['health', 'wealth', 'career', 'business', 'experiences', 'personal'];
  var SOURCE_LABELS = { manual: 'Manual', finance: 'Finance', running: 'Running', fitness: 'Fitness', water: 'Water' };
  var STATUS_META = {
    on_track: { label: 'On Track', color: 'var(--success)' },
    at_risk:  { label: 'At Risk',  color: 'var(--warning)' },
    behind:   { label: 'Behind',   color: 'var(--danger)' }
  };

  function fmtMoney(n) {
    if (n == null || !isFinite(n)) return '—';
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function fmtClock(sec) {
    if (sec == null || !isFinite(sec)) return '—';
    sec = Math.round(sec);
    var h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h > 0 ? h + ':' + pad2(m) + ':' + pad2(s) : m + ':' + pad2(s);
  }
  function parseClockToSec(str) {
    if (!str) return null;
    var parts = String(str).trim().split(':').map(Number);
    if (parts.some(isNaN)) return null;
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return parts[0];
  }
  var SPLIT_LABELS = { push: 'Push', pull: 'Pull', legs: 'Legs', full: 'Full Body' };

  function computeProgress(goal) {
    var ev = null;
    if (goal.source === 'finance') ev = Evidence.finance();
    else if (goal.source === 'running') ev = Evidence.running();
    else if (goal.source === 'fitness') ev = Evidence.fitness();
    else if (goal.source === 'water') ev = Evidence.water();

    if (goal.type === 'milestones') {
      var ms = milestonesForGoal(goal.id);
      var total = ms.length, done = ms.filter(function (m) { return m.done; }).length;
      var pct = total ? Math.round(done / total * 100) : 0;
      return {
        pct: pct, isLive: false, sourceLabel: 'Manual',
        currentLabel: total ? (done + ' / ' + total + ' milestones') : 'No milestones yet',
        targetLabel: '', remainingLabel: null
      };
    }

    if (goal.type === 'currency') {
      var current = (ev && ev.currentTotal != null) ? ev.currentTotal : goal.manualCurrent;
      var isLive = !!(ev && ev.currentTotal != null);
      var target = goal.manualTarget;
      var pct2 = (target > 0 && current != null) ? Math.min(100, Math.max(0, Math.round(current / target * 100))) : 0;
      return {
        pct: pct2, isLive: isLive, sourceLabel: isLive ? SOURCE_LABELS[goal.source] : 'Manual',
        currentLabel: fmtMoney(current), targetLabel: fmtMoney(target),
        remainingLabel: (current != null && target != null) ? fmtMoney(Math.max(0, target - current)) + ' to go' : null
      };
    }

    if (goal.type === 'time') {
      // Lower is better here, so the shared "<current> of <target>" template
      // phrasing (built for currency/water, where current climbs toward
      // target) would read backwards — a 3:46 PB "of" a 3:29 goal looks like
      // a typo. Spell out PB vs goal explicitly instead, and turn the gap
      // into a plain "time to shave off" instead of a raw target label.
      var currentSec = null, isLive3 = false;
      if (ev && ev.pbs && ev.pbs.marathon) { currentSec = ev.pbs.marathon; isLive3 = true; }
      else currentSec = goal.manualCurrentSec;
      var targetSec = goal.manualTargetSec;
      var pct3 = (currentSec && targetSec) ? Math.min(100, Math.max(0, Math.round(targetSec / currentSec * 100))) : 0;
      var remainingLabel3 = null;
      if (currentSec && targetSec) {
        var diffSec = currentSec - targetSec;
        remainingLabel3 = diffSec > 0 ? (fmtClock(diffSec) + ' to shave off') : 'Goal achieved! 🎉';
      }
      return {
        pct: pct3, isLive: isLive3, sourceLabel: isLive3 ? SOURCE_LABELS[goal.source] : 'Manual',
        currentLabel: (currentSec ? ('PB ' + fmtClock(currentSec)) : 'No time recorded yet') + ' · Goal ' + fmtClock(targetSec),
        targetLabel: '',
        remainingLabel: remainingLabel3
      };
    }

    if (goal.type === 'weekly') {
      // Fitness weekly goals track split-type coverage (one push, one pull,
      // one legs, one full-body day per week) rather than a plain session
      // count — see Evidence.fitness(). Any other 'weekly' source falls
      // back to the plain sessions-vs-target math below.
      if (goal.source === 'fitness' && ev && ev.weekTypesDone) {
        var required = ev.weekTypesRequired;
        var done = ev.weekTypesDone;
        var doneLabels = done.map(function (s) { return SPLIT_LABELS[s] || s; });
        var missingLabels = required.filter(function (s) { return done.indexOf(s) === -1; })
          .map(function (s) { return SPLIT_LABELS[s] || s; });
        var pct4f = Math.round(done.length / required.length * 100);
        return {
          pct: pct4f, isLive: true, sourceLabel: SOURCE_LABELS[goal.source],
          currentLabel: done.length + ' / ' + required.length + ' this week'
            + (doneLabels.length ? ' (' + doneLabels.join(', ') + ')' : '')
            + (missingLabels.length ? ' — need ' + missingLabels.join(', ') : ' — complete!'),
          targetLabel: '',
          remainingLabel: ev.streakWeeks > 0 ? ('🔥 ' + ev.streakWeeks + '-week streak') : null
        };
      }
      var current4 = (ev && ev.sessionsLast7Days != null) ? ev.sessionsLast7Days : goal.manualCurrent;
      var isLive4 = !!(ev && ev.sessionsLast7Days != null);
      var target4 = goal.manualTarget;
      var pct4 = target4 ? Math.min(100, Math.max(0, Math.round((current4 || 0) / target4 * 100))) : 0;
      return {
        pct: pct4, isLive: isLive4, sourceLabel: isLive4 ? SOURCE_LABELS[goal.source] : 'Manual',
        currentLabel: (current4 || 0) + ' / ' + target4 + ' this week', targetLabel: '', remainingLabel: null
      };
    }

    if (goal.type === 'daily') {
      var currentMl = (ev && ev.todayMl != null) ? ev.todayMl : goal.manualCurrent;
      var isLive5 = !!(ev && ev.todayMl != null);
      var targetMl = (ev && ev.targetMl != null) ? ev.targetMl : goal.manualTarget;
      var pct5 = targetMl ? Math.min(100, Math.max(0, Math.round((currentMl || 0) / targetMl * 100))) : 0;
      return {
        pct: pct5, isLive: isLive5, sourceLabel: isLive5 ? SOURCE_LABELS[goal.source] : 'Manual',
        currentLabel: ((currentMl || 0) / 1000).toFixed(1) + 'L today', targetLabel: (targetMl / 1000).toFixed(1) + 'L target',
        remainingLabel: null
      };
    }

    // 'number' — plain manual current/target
    var current6 = goal.manualCurrent || 0, target6 = goal.manualTarget || 0;
    var pct6 = target6 ? Math.min(100, Math.max(0, Math.round(current6 / target6 * 100))) : 0;
    return {
      pct: pct6, isLive: false, sourceLabel: 'Manual',
      currentLabel: String(current6), targetLabel: String(target6), remainingLabel: null
    };
  }

  function computeStatus(goal, pct) {
    if (goal.statusOverride && goal.statusOverride !== 'auto') return goal.statusOverride;
    if (!goal.targetDate || !goal.createdAt) return 'on_track';
    var now = Date.now();
    var start = goal.createdAt;
    var end = new Date(goal.targetDate + 'T23:59:59').getTime();
    if (isNaN(end)) return 'on_track';
    if (now >= end) return pct >= 100 ? 'on_track' : 'behind';
    if (end <= start) return 'on_track';
    var elapsedFrac = Math.min(1, Math.max(0, (now - start) / (end - start)));
    var expectedPct = elapsedFrac * 100;
    var diff = pct - expectedPct;
    if (diff >= -5) return 'on_track';
    if (diff >= -20) return 'at_risk';
    return 'behind';
  }

  // Overall North Star progress — the one number both the full page
  // and the main.html preview show. Respects a manual override if the
  // user set one; otherwise it's a WEIGHTED average of every active,
  // non-habit goal's computeProgress().pct — a flat average across
  // everything from a marathon PB to a milestone checklist to "drink
  // water" was exactly the kind of comfortable-but-meaningless number
  // that hides which goals actually matter, so completed goals, habits,
  // and low-importance goals no longer get to move this number as much
  // (or at all) as the goal you actually weighted as High.
  function computeOverallProgress() {
    var ns = getNorthStar();
    if (ns.progressOverride != null && ns.progressOverride !== '') {
      return Math.max(0, Math.min(100, Math.round(ns.progressOverride)));
    }
    var goals = (getGoals() || []).filter(function (g) { return !g.archived && !isHabit(g) && !g.upcoming; });
    if (!goals.length) return 0;
    var weightSum = 0, weightedPct = 0;
    goals.forEach(function (g) {
      var w = g.weight || DEFAULT_WEIGHT;
      weightSum += w;
      weightedPct += computeProgress(g).pct * w;
    });
    return weightSum ? Math.round(weightedPct / weightSum) : 0;
  }

  global.GoalsData = {
    getNorthStar: getNorthStar, setNorthStar: setNorthStar,
    getGoals: getGoals, setGoals: setGoals, addGoal: addGoal, patchGoal: patchGoal, deleteGoal: deleteGoal,
    getMilestones: getMilestones, setMilestones: setMilestones, addMilestone: addMilestone,
    patchMilestone: patchMilestone, deleteMilestone: deleteMilestone, milestonesForGoal: milestonesForGoal,
    createTaskFromMilestone: createTaskFromMilestone, findTaskById: findTaskById,
    linkedTaskDone: linkedTaskDone, syncLinkedTaskDone: syncLinkedTaskDone, allTasksForGoal: allTasksForGoal,
    Evidence: Evidence,
    newId: newId, todayKeyStr: todayKeyStr,
    CATEGORY_META: CATEGORY_META, CATEGORY_ORDER: CATEGORY_ORDER, SOURCE_LABELS: SOURCE_LABELS, STATUS_META: STATUS_META,
    WEIGHT_META: WEIGHT_META, DEFAULT_WEIGHT: DEFAULT_WEIGHT, isHabit: isHabit,
    fmtMoney: fmtMoney, fmtClock: fmtClock, parseClockToSec: parseClockToSec,
    computeProgress: computeProgress, computeStatus: computeStatus, computeOverallProgress: computeOverallProgress
  };
})(window);
