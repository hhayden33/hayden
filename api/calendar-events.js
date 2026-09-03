// =============================================================
// Proxies Google Calendar for the dashboard's Calendar section. The
// browser only ever talks to this endpoint — never to Google directly
// — so no Google token of any kind is ever visible client-side.
//
// Day/week boundaries are computed in Australia/Melbourne, same as
// js/weather.js's hardcoded Melbourne coordinates elsewhere on this
// page; this is a single-city personal dashboard, not a multi-timezone
// product, so there's no user-facing timezone setting to read instead.
// =============================================================
'use strict';

const SUPABASE_URL = 'https://itidzioouqjbwnyvekkw.supabase.co';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const CALENDAR_LIST_URL = 'https://www.googleapis.com/calendar/v3/users/me/calendarList';
const TOKEN_ROW_ID = 'default';
const TIME_ZONE = 'Australia/Melbourne';

// Same waking-hours window js/day-ring.js already shows on this page —
// free blocks outside it aren't useful "availability" (you're asleep).
const WAKE_HOUR = 7;
const SLEEP_HOUR = 23.5;
const MIN_FREE_BLOCK_MIN = 20; // hide gaps too short to actually do anything in

const ALLOWED_ORIGINS = [
  'https://hayden-delta.vercel.app',
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5500',
  'http://127.0.0.1:5500',
];
function refererOrigin(referer) {
  if (!referer) return null;
  try { return new URL(referer).origin; } catch (e) { return null; }
}

// ---------- rate limiting (same shape as api/claude.js's — see that
// file's own comment for why in-memory is an accepted tradeoff here) ----------
const IP_WINDOW_MS = 10 * 60 * 1000;
const IP_MAX_PER_WINDOW = 30;
const ipHits = new Map();
function rateLimited(req) {
  const now = Date.now();
  const fwd = req.headers['x-forwarded-for'];
  const ip = (typeof fwd === 'string' && fwd.trim()) ? fwd.split(',')[0].trim() : (req.socket && req.socket.remoteAddress || 'unknown');
  const hits = (ipHits.get(ip) || []).filter((t) => now - t < IP_WINDOW_MS);
  if (hits.length >= IP_MAX_PER_WINDOW) { ipHits.set(ip, hits); return true; }
  hits.push(now);
  ipHits.set(ip, hits);
  return false;
}

// ---------- tiny response cache — collapses near-simultaneous requests
// (e.g. two devices/tabs opening the dashboard within the same minute)
// into one set of Google API calls. Not a substitute for the client's
// own longer-lived cache in js/calendar.js; just insurance at the edge. ----------
const CACHE_TTL_MS = 90 * 1000;
let cache = null; // { at, body }

// ---------- Melbourne-local <-> UTC ----------
function melbourneOffsetMinutes(instant) {
  const utc = new Date(instant.toLocaleString('en-US', { timeZone: 'UTC' }));
  const mel = new Date(instant.toLocaleString('en-US', { timeZone: TIME_ZONE }));
  return Math.round((mel - utc) / 60000);
}
function melbourneLocalToUTC(y, m, d, hour) {
  const wholeHour = Math.floor(hour);
  const minute = Math.round((hour - wholeHour) * 60);
  const naive = new Date(Date.UTC(y, m - 1, d, wholeHour, minute, 0));
  return new Date(naive.getTime() - melbourneOffsetMinutes(naive) * 60000);
}
function melbourneNowParts() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => Number(parts.find((p) => p.type === t).value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}
function ymdKey(y, m, d) { return y + '-' + String(m).padStart(2, '0') + '-' + String(d).padStart(2, '0'); }
function addDays(y, m, d, n) {
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return { y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() };
}
function dayNameShort(y, m, d) {
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { weekday: 'short', timeZone: 'UTC' });
}

// ---------- Supabase (service_role — see calendar-callback.js's header
// comment for why this table is unreachable via the public anon key) ----------
async function loadRefreshToken(serviceKey) {
  const r = await fetch(SUPABASE_URL + '/rest/v1/google_calendar_auth?id=eq.' + TOKEN_ROW_ID + '&select=refresh_token', {
    headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
  });
  if (!r.ok) return null;
  const rows = await r.json().catch(() => []);
  return (rows && rows[0] && rows[0].refresh_token) || null;
}
async function deleteRefreshToken(serviceKey) {
  try {
    await fetch(SUPABASE_URL + '/rest/v1/google_calendar_auth?id=eq.' + TOKEN_ROW_ID, {
      method: 'DELETE',
      headers: { apikey: serviceKey, Authorization: 'Bearer ' + serviceKey },
    });
  } catch (e) { /* best-effort */ }
}

async function refreshAccessToken(refreshToken, clientId, clientSecret) {
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'refresh_token',
    }).toString(),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    const revoked = r.status === 400 || r.status === 401; // invalid_grant, etc.
    return { ok: false, revoked, status: r.status, errText };
  }
  const data = await r.json();
  return { ok: true, accessToken: data.access_token };
}

// ---------- meeting link extraction ----------
function meetingLinkOf(ev) {
  if (ev.hangoutLink) return ev.hangoutLink;
  const entryPoints = ev.conferenceData && ev.conferenceData.entryPoints;
  if (Array.isArray(entryPoints)) {
    const video = entryPoints.find((e) => e.entryPointType === 'video');
    if (video && video.uri) return video.uri;
  }
  return null;
}

// ---------- free-block computation ----------
// Merges today's busy intervals (clipped to the waking-hours window and
// to "now" onward) and returns the gaps — the deliberately simple
// version of availability, not a full free/busy analysis.
function computeFreeBlocksToday(todayEvents, nowUtcMs, dayStartUtcMs, dayEndUtcMs) {
  const lowerBound = Math.max(nowUtcMs, dayStartUtcMs);
  const busy = todayEvents
    .filter((e) => !e.allDay)
    .map((e) => ({ start: Math.max(new Date(e.start).getTime(), dayStartUtcMs), end: Math.min(new Date(e.end).getTime(), dayEndUtcMs) }))
    .filter((iv) => iv.end > iv.start)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const iv of busy) {
    const last = merged[merged.length - 1];
    if (last && iv.start <= last.end) last.end = Math.max(last.end, iv.end);
    else merged.push({ start: iv.start, end: iv.end });
  }

  const free = [];
  let cursor = lowerBound;
  for (const iv of merged) {
    if (iv.start > cursor) free.push({ start: cursor, end: iv.start });
    cursor = Math.max(cursor, iv.end);
  }
  if (cursor < dayEndUtcMs) free.push({ start: cursor, end: dayEndUtcMs });

  return free
    .filter((b) => (b.end - b.start) / 60000 >= MIN_FREE_BLOCK_MIN)
    .map((b) => ({ start: new Date(b.start).toISOString(), end: new Date(b.end).toISOString() }));
}

module.exports = async function handler(req, res) {
  // Browsers reliably send Origin on state-changing requests (POST etc,
  // see api/claude.js) but frequently omit it on a plain same-origin GET
  // fetch — which is exactly what js/calendar.js makes. Falling back to
  // Referer's origin (always present on a fetch triggered by a loaded
  // page) avoids rejecting the dashboard's own requests; a request with
  // neither header present is still denied.
  const origin = req.headers.origin || refererOrigin(req.headers.referer);
  const originAllowed = !!origin && ALLOWED_ORIGINS.indexOf(origin) !== -1;
  res.setHeader('Vary', 'Origin');
  if (req.headers.origin && originAllowed) res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

  if (req.method === 'OPTIONS') return res.status(originAllowed ? 204 : 403).end();
  if (!originAllowed) return res.status(403).json({ error: 'forbidden' });
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' });
  if (rateLimited(req)) return res.status(429).json({ error: 'rate_limited' });

  if (cache && Date.now() - cache.at < CACHE_TTL_MS) {
    return res.status(200).json(cache.body);
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!clientId || !clientSecret || !serviceKey) {
    console.error('calendar-events: missing GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/SUPABASE_SERVICE_ROLE_KEY');
    return res.status(502).json({ error: 'not_configured' });
  }

  let refreshToken;
  try {
    refreshToken = await loadRefreshToken(serviceKey);
  } catch (e) {
    console.error('calendar-events: loading refresh_token failed', e);
    return res.status(502).json({ error: 'storage_unavailable' });
  }
  if (!refreshToken) return res.status(401).json({ error: 'not_connected' });

  const tokenResult = await refreshAccessToken(refreshToken, clientId, clientSecret);
  if (!tokenResult.ok) {
    console.error('calendar-events: access token refresh failed', tokenResult.status, tokenResult.errText);
    if (tokenResult.revoked) {
      await deleteRefreshToken(serviceKey);
      return res.status(401).json({ error: 'auth_expired' });
    }
    return res.status(502).json({ error: 'upstream_error' });
  }
  const accessToken = tokenResult.accessToken;
  const authHeader = { Authorization: 'Bearer ' + accessToken };

  const now = melbourneNowParts();
  const dayStart = melbourneLocalToUTC(now.year, now.month, now.day, 0);
  const weekEnd = addDays(now.year, now.month, now.day, 7);
  const rangeEnd = melbourneLocalToUTC(weekEnd.y, weekEnd.m, weekEnd.d, 0);
  const nowUtcMs = Date.now();

  let calendarListJson;
  try {
    const clRes = await fetch(CALENDAR_LIST_URL + '?minAccessRole=reader', { headers: authHeader });
    if (!clRes.ok) throw new Error('calendarList ' + clRes.status);
    calendarListJson = await clRes.json();
  } catch (e) {
    console.error('calendar-events: calendarList fetch failed', e);
    return res.status(502).json({ error: 'upstream_error' });
  }

  // Only calendars actually checked in your own Google Calendar sidebar
  // (selected !== false) — not every calendar you've ever been added to.
  const calendars = (calendarListJson.items || [])
    .filter((c) => c.selected !== false)
    .map((c) => ({ id: c.id, name: c.summaryOverride || c.summary, color: c.backgroundColor || '#687580', primary: !!c.primary }));

  const eventLists = await Promise.all(calendars.map(async (cal) => {
    const params = new URLSearchParams({
      timeMin: dayStart.toISOString(),
      timeMax: rangeEnd.toISOString(),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
    });
    try {
      const evRes = await fetch('https://www.googleapis.com/calendar/v3/calendars/' + encodeURIComponent(cal.id) + '/events?' + params.toString(), { headers: authHeader });
      if (!evRes.ok) { console.error('calendar-events: events fetch failed for', cal.id, evRes.status); return []; }
      const evJson = await evRes.json();
      return (evJson.items || [])
        .filter((e) => e.status !== 'cancelled' && (e.start))
        .map((e) => {
          const allDay = !!(e.start.date && !e.start.dateTime);
          return {
            id: e.id,
            calendarId: cal.id,
            calendarName: cal.name,
            calendarColor: cal.color,
            title: e.summary || '(No title)',
            start: allDay ? e.start.date : e.start.dateTime,
            end: allDay ? e.end.date : e.end.dateTime,
            allDay: allDay,
            location: e.location || null,
            meetingLink: meetingLinkOf(e),
            status: e.status,
          };
        });
    } catch (e) {
      console.error('calendar-events: events fetch threw for', cal.id, e);
      return [];
    }
  }));

  const events = eventLists.flat().sort((a, b) => new Date(a.start) - new Date(b.start));
  const todayKey = ymdKey(now.year, now.month, now.day);
  const todayEvents = events.filter((e) => (e.allDay ? e.start === todayKey : e.start.slice(0, 10) === todayKey || e.end.slice(0, 10) === todayKey));

  const dayEnd = melbourneLocalToUTC(now.year, now.month, now.day, SLEEP_HOUR);
  const wakeUtc = melbourneLocalToUTC(now.year, now.month, now.day, WAKE_HOUR);
  const freeBlocksToday = computeFreeBlocksToday(todayEvents, nowUtcMs, wakeUtc.getTime(), dayEnd.getTime());

  // Compact per-day event titles for the "next 7 days" strip — the
  // client still owns matching these against any dashboard-known
  // training plan (js/calendar.js reads weekplan:<isoWeek> itself), so
  // this endpoint only ever describes what Google actually said.
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(now.year, now.month, now.day, i);
    const key = ymdKey(d.y, d.m, d.d);
    const dayTitles = events
      .filter((e) => (e.allDay ? e.start === key : e.start.slice(0, 10) === key))
      .map((e) => e.title);
    days.push({ date: key, label: dayNameShort(d.y, d.m, d.d), titles: dayTitles });
  }

  const body = {
    connected: true,
    generatedAt: new Date().toISOString(),
    timeZone: TIME_ZONE,
    calendars: calendars,
    events: events,
    freeBlocksToday: freeBlocksToday,
    next7Days: days,
  };
  cache = { at: Date.now(), body: body };
  return res.status(200).json(body);
};
