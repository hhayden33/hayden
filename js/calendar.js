// =============================================================
// Calendar — a compact, read-only summary layer over Google Calendar,
// not a rebuild of it. Fetches /api/calendar-events (which is the only
// thing that ever talks to Google — no token of any kind lives in this
// file or in localStorage), caches the result briefly, and renders
// three things: today's events, today's free blocks, and a 7-day
// overview. Cross-references js/week-planner.js's own weekplan:<week>
// data for the 7-day strip — that's dashboard-known training context,
// not something inferred from calendar text.
//
// window.Calendar below is the deliberately-clean data surface meant
// for Claude to eventually reason over ("what's my schedule today",
// "when's my next free block") — the API response IS the data model,
// this file mostly just renders it.
// =============================================================
(function () {
  'use strict';

  const Dash = window.Dash;
  const storeGet = Dash.storeGet;
  const storeSet = Dash.storeSet;

  const CACHE_KEY = 'calendar:cache';
  const CACHE_FRESH_MS = 5 * 60 * 1000;
  const REFRESH_INTERVAL_MS = 5 * 60 * 1000;

  // ---------- small date helpers, duplicated rather than shared — same
  // reasoning goals-data.js/ticker.js give for their own copies: pure
  // date math, no shared module to pull from. ----------
  function pad2(n) { return String(n).padStart(2, '0'); }
  function todayKey() { const d = new Date(); return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate()); }
  function mondayOf(date) {
    const d = new Date(date);
    const day = d.getDay();
    d.setDate(d.getDate() + (day === 0 ? -6 : 1 - day));
    d.setHours(0, 0, 0, 0);
    return d;
  }
  function isoWeekKey(date) {
    const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
    const dayNum = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - dayNum);
    const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
    const weekNo = Math.ceil((((d - yearStart) / 86400000) + 1) / 7);
    return d.getUTCFullYear() + '-W' + pad2(weekNo);
  }
  // Same split-tag palette/labels js/week-planner.js and topbar.js use.
  const SPLIT_TAG_COLORS = { push: '#087CA3', pull: '#20A5A0', legs: '#B98AE0', full: '#F2C063', run: '#A83FAF' };
  const SPLIT_TAG_LABELS = { push: 'Push', pull: 'Pull', legs: 'Legs', full: 'Full', run: 'Run', rest: 'Rest' };
  function plannedSplitFor(dateKey) {
    const d = new Date(dateKey + 'T00:00:00');
    const weekKey = isoWeekKey(mondayOf(d));
    const plan = storeGet('weekplan:' + weekKey);
    const splits = plan && plan[dateKey];
    if (!Array.isArray(splits) || !splits.length) return null;
    return splits[0]; // day-strip tag already only shows one at a time for the 7-day glance
  }

  function fmtTime(iso) {
    const d = new Date(iso);
    let h = d.getHours();
    const m = d.getMinutes();
    const ampm = h >= 12 ? 'PM' : 'AM';
    h = h % 12; if (h === 0) h = 12;
    return h + (m ? ':' + pad2(m) : '') + ' ' + ampm;
  }
  function fmtDateHeader() {
    return new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }

  // ---------- fetch + cache ----------
  function loadCache() {
    const c = storeGet(CACHE_KEY);
    return (c && typeof c === 'object') ? c : null;
  }
  function saveCache(body) {
    storeSet(CACHE_KEY, { at: Date.now(), body: body });
  }

  async function fetchCalendar(force) {
    const cached = loadCache();
    if (!force && cached && Date.now() - cached.at < CACHE_FRESH_MS) {
      render(cached.body);
      return;
    }
    if (cached) render(cached.body, { stale: true }); // show what we have while refreshing
    else renderLoading();

    let res;
    try {
      res = await fetch('/api/calendar-events');
    } catch (e) {
      if (cached) render(cached.body, { stale: true, refreshFailed: true });
      else renderError('Couldn’t reach the calendar service. Check your connection.');
      return;
    }

    if (res.status === 401) {
      const body = await res.json().catch(() => ({}));
      if (body.error === 'auth_expired') renderReconnect('Google Calendar access expired — reconnect to keep this in sync.');
      else renderConnectPrompt();
      storeSet(CACHE_KEY, null);
      return;
    }
    if (!res.ok) {
      // 'not_configured' isn't transient — it means the Google/Supabase
      // env vars from GOOGLE_CALENDAR_SETUP.md haven't been set on
      // Vercel yet, and will say so on every request until they are.
      // Worth a distinct message rather than the generic one below,
      // which reads like a temporary blip that'll resolve on its own.
      const body = await res.json().catch(() => ({}));
      if (body.error === 'not_configured') {
        renderError('Calendar integration isn’t set up yet — see GOOGLE_CALENDAR_SETUP.md for the Google Cloud Console, Supabase, and Vercel steps.');
        return;
      }
      if (cached) render(cached.body, { stale: true, refreshFailed: true });
      else renderError('Calendar is temporarily unavailable.');
      return;
    }

    const body = await res.json().catch(() => null);
    if (!body) { renderError('Calendar returned an unexpected response.'); return; }
    saveCache(body);
    render(body);
  }

  // ---------- render: state panels ----------
  function showOnly(id) {
    ['gcalLoading', 'gcalConnectPrompt', 'gcalErrorState', 'gcalBody'].forEach(function (elId) {
      const el = document.getElementById(elId);
      if (el) el.style.display = (elId === id) ? '' : 'none';
    });
  }
  function renderLoading() { showOnly('gcalLoading'); }
  function renderConnectPrompt() { showOnly('gcalConnectPrompt'); }
  function renderReconnect(message) {
    const prompt = document.getElementById('gcalConnectPrompt');
    const msgEl = document.getElementById('gcalConnectMessage');
    if (msgEl) msgEl.textContent = message;
    showOnly('gcalConnectPrompt');
  }
  function renderError(message) {
    const el = document.getElementById('gcalErrorState');
    el.textContent = message;
    showOnly('gcalErrorState');
  }

  // ---------- render: connected body ----------
  let lastData = null;

  function buildEventRow(ev, opts) {
    const li = document.createElement('li');
    li.className = 'gm-row gcal-row' + (opts.isNow ? ' gcal-row-now' : opts.isNext ? ' gcal-row-next' : '');

    const time = document.createElement('div');
    time.className = 'gcal-row-time';
    time.textContent = ev.allDay ? 'All day' : fmtTime(ev.start);
    li.appendChild(time);

    const main = document.createElement('div');
    main.className = 'gcal-row-main';

    const titleRow = document.createElement('div');
    titleRow.className = 'gcal-row-title-row';
    const title = document.createElement('span');
    title.className = 'gcal-row-title';
    title.textContent = ev.title;
    titleRow.appendChild(title);
    if (opts.isNow) {
      const pill = document.createElement('span');
      pill.className = 'gcal-pill gcal-pill-now';
      pill.textContent = 'NOW';
      titleRow.appendChild(pill);
    } else if (opts.isNext) {
      const pill = document.createElement('span');
      pill.className = 'gcal-pill gcal-pill-next';
      pill.textContent = 'NEXT';
      titleRow.appendChild(pill);
    }
    main.appendChild(titleRow);

    if (opts.showCalendarName && ev.calendarName) {
      const src = document.createElement('span');
      src.className = 'gcal-row-cal';
      src.style.setProperty('--gcal-dot', ev.calendarColor);
      src.textContent = ev.calendarName;
      main.appendChild(src);
    }

    if (ev.location || ev.meetingLink) {
      const meta = document.createElement('div');
      meta.className = 'gcal-row-meta';
      if (ev.location) {
        const loc = document.createElement('span');
        loc.className = 'gcal-row-loc';
        loc.textContent = ev.location;
        meta.appendChild(loc);
      }
      if (ev.meetingLink) {
        const link = document.createElement('a');
        link.className = 'gcal-row-link';
        link.href = ev.meetingLink;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.textContent = 'Join';
        meta.appendChild(link);
      }
      main.appendChild(meta);
    }

    li.appendChild(main);
    return li;
  }

  function renderToday(data) {
    const list = document.getElementById('gcalTodayList');
    const empty = document.getElementById('gcalTodayEmpty');
    const eyebrow = document.getElementById('gcalTodayEyebrow');
    eyebrow.textContent = 'TODAY — ' + fmtDateHeader().toUpperCase();

    const key = todayKey();
    const now = Date.now();
    const todays = data.events
      .filter(function (e) { return e.allDay ? e.start === key : e.start.slice(0, 10) === key; })
      .sort(function (a, b) { return new Date(a.start) - new Date(b.start); });

    list.innerHTML = '';
    if (!todays.length) {
      empty.style.display = 'block';
      return;
    }
    empty.style.display = 'none';

    // "Next" is the soonest event that hasn't started yet; "now" is
    // whichever timed event currently spans this instant (an all-day
    // event never counts as "now" — it isn't a block of time to be in).
    const nextEvent = todays.find(function (e) { return !e.allDay && new Date(e.start).getTime() > now; });
    const showCalendarNames = data.calendars.filter(function (c) { return !c.primary; }).length > 0;

    todays.forEach(function (ev) {
      const isNow = !ev.allDay && new Date(ev.start).getTime() <= now && now < new Date(ev.end).getTime();
      const isNext = !isNow && nextEvent && ev.id === nextEvent.id;
      list.appendChild(buildEventRow(ev, { isNow: isNow, isNext: isNext, showCalendarName: showCalendarNames }));
    });
  }

  function renderFreeBlocks(data) {
    const row = document.getElementById('gcalFreeRow');
    const subhead = document.getElementById('gcalFreeSubhead');
    row.innerHTML = '';
    if (!data.freeBlocksToday.length) {
      subhead.style.display = 'none';
      row.style.display = 'none';
      return;
    }
    subhead.style.display = '';
    row.style.display = '';
    data.freeBlocksToday.forEach(function (b) {
      const chip = document.createElement('div');
      chip.className = 'gcal-free-chip';
      chip.textContent = fmtTime(b.start) + ' → ' + fmtTime(b.end);
      row.appendChild(chip);
    });
  }

  function renderWeek(data) {
    const wrap = document.getElementById('gcalWeekList');
    wrap.innerHTML = '';
    data.next7Days.forEach(function (day, i) {
      const row = document.createElement('div');
      row.className = 'gcal-week-row' + (i === 0 ? ' gcal-week-row-today' : '');

      const dayEl = document.createElement('span');
      dayEl.className = 'gcal-week-day';
      dayEl.textContent = i === 0 ? 'Today' : day.label;
      row.appendChild(dayEl);

      const titlesEl = document.createElement('span');
      titlesEl.className = 'gcal-week-titles';
      if (day.titles.length) {
        const shown = day.titles.slice(0, 3);
        const extra = day.titles.length - shown.length;
        titlesEl.textContent = shown.join(' · ') + (extra > 0 ? ' +' + extra : '');
      } else {
        titlesEl.textContent = '—';
        titlesEl.classList.add('gcal-week-titles-empty');
      }
      row.appendChild(titlesEl);

      const split = plannedSplitFor(day.date);
      if (split) {
        const tag = document.createElement('span');
        tag.className = 'gcal-week-tag';
        tag.style.setProperty('--split-color', SPLIT_TAG_COLORS[split] || '#687580');
        tag.textContent = SPLIT_TAG_LABELS[split] || split;
        row.appendChild(tag);
      }

      wrap.appendChild(row);
    });
  }

  function render(data, opts) {
    opts = opts || {};
    lastData = data;
    showOnly('gcalBody');
    renderToday(data);
    renderFreeBlocks(data);
    renderWeek(data);
    // Stale-while-refreshing / refresh-failed states are deliberately
    // quiet (no error banner over data that's still probably right) —
    // a small note is enough since the underlying schedule rarely
    // changes minute to minute.
    const note = document.getElementById('gcalStaleNote');
    if (note) note.style.display = opts.refreshFailed ? '' : 'none';
  }

  // ---------- OAuth redirect completion ----------
  function handleOAuthRedirect() {
    const params = new URLSearchParams(window.location.search);
    const connected = params.get('calendar_connected');
    const error = params.get('calendar_error');
    if (!connected && !error) return false;
    params.delete('calendar_connected');
    params.delete('calendar_error');
    const qs = params.toString();
    const newUrl = window.location.pathname + (qs ? '?' + qs : '') + window.location.hash;
    window.history.replaceState(null, '', newUrl);
    if (error) {
      renderError('Couldn’t connect Google Calendar (' + error + '). Try again.');
      return true;
    }
    return false; // connected — fall through to a fresh, forced fetch
  }

  function boot() {
    const cameFromOAuth = handleOAuthRedirect();
    fetchCalendar(cameFromOAuth);
    setInterval(function () { fetchCalendar(false); }, REFRESH_INTERVAL_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible') fetchCalendar(false);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // ---------- data surface for future Claude/AI reasoning ----------
  window.Calendar = {
    getData: function () { return lastData; },
    getTodayEvents: function () {
      if (!lastData) return [];
      const key = todayKey();
      return lastData.events.filter(function (e) { return e.allDay ? e.start === key : e.start.slice(0, 10) === key; });
    },
    getFreeBlocksToday: function () { return lastData ? lastData.freeBlocksToday : []; },
    getNext7Days: function () { return lastData ? lastData.next7Days : []; },
    refresh: function () { return fetchCalendar(true); },
  };
})();
