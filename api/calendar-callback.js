// =============================================================
// Step 2 of the Google Calendar OAuth flow. Google redirects here with
// ?code=...&state=... after you approve consent. Exchanges the code
// for tokens server-side (client_secret never leaves this function),
// then stores only the refresh_token — access tokens are short-lived
// and cheap to re-derive per request in calendar-events.js, so there's
// nothing else worth persisting.
//
// The refresh_token is written to Supabase via the service_role key,
// not the public anon key sync.js/goals-data.js use — see the SQL in
// this repo's setup notes: that table has RLS enabled with zero
// policies, so the anon key (or anyone with it, which is effectively
// public since it ships in frontend JS) has no access to it at all.
// service_role bypasses RLS by design and only ever exists as a
// Vercel env var.
// =============================================================
'use strict';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const SUPABASE_URL = 'https://itidzioouqjbwnyvekkw.supabase.co';
const STATE_COOKIE = 'gcal_oauth_state';
const TOKEN_ROW_ID = 'default'; // single-user app — one row, always this id

function parseCookies(header) {
  const out = {};
  if (!header) return out;
  header.split(';').forEach(function (part) {
    const eq = part.indexOf('=');
    if (eq === -1) return;
    out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim());
  });
  return out;
}

function clearStateCookie(res) {
  res.setHeader('Set-Cookie', STATE_COOKIE + '=; Max-Age=0; Path=/api/calendar-callback; HttpOnly; Secure; SameSite=Lax');
}

function failRedirect(res, reason) {
  res.statusCode = 302;
  res.setHeader('Location', '/main.html?calendar_error=' + encodeURIComponent(reason) + '#calendar');
  res.end();
}

module.exports = async function handler(req, res) {
  const url = new URL(req.url, 'http://placeholder');
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const err = url.searchParams.get('error');

  if (err) { clearStateCookie(res); return failRedirect(res, 'consent_denied'); }

  const cookies = parseCookies(req.headers.cookie);
  const expectedState = cookies[STATE_COOKIE];
  clearStateCookie(res);

  if (!state || !expectedState || state !== expectedState) {
    return failRedirect(res, 'state_mismatch');
  }
  if (!code) {
    return failRedirect(res, 'missing_code');
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!clientId || !clientSecret || !redirectUri || !serviceKey) {
    console.error('calendar-callback: missing one of GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET/GOOGLE_REDIRECT_URI/SUPABASE_SERVICE_ROLE_KEY');
    return failRedirect(res, 'not_configured');
  }

  let tokens;
  try {
    const tokenRes = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }).toString(),
    });
    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(function () { return ''; });
      console.error('calendar-callback: token exchange failed', tokenRes.status, errText);
      return failRedirect(res, 'token_exchange_failed');
    }
    tokens = await tokenRes.json();
  } catch (e) {
    console.error('calendar-callback: token exchange request failed', e);
    return failRedirect(res, 'token_exchange_failed');
  }

  if (!tokens.refresh_token) {
    // Shouldn't happen with access_type=offline&prompt=consent, but if
    // Google ever omits it there's nothing durable to store.
    console.error('calendar-callback: no refresh_token in response', JSON.stringify(Object.keys(tokens)));
    return failRedirect(res, 'no_refresh_token');
  }

  try {
    const upsertRes = await fetch(SUPABASE_URL + '/rest/v1/google_calendar_auth?on_conflict=id', {
      method: 'POST',
      headers: {
        'apikey': serviceKey,
        'Authorization': 'Bearer ' + serviceKey,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates',
      },
      body: JSON.stringify({
        id: TOKEN_ROW_ID,
        refresh_token: tokens.refresh_token,
        scope: tokens.scope || null,
        updated_at: new Date().toISOString(),
      }),
    });
    if (!upsertRes.ok) {
      const errText = await upsertRes.text().catch(function () { return ''; });
      console.error('calendar-callback: storing refresh_token failed', upsertRes.status, errText);
      return failRedirect(res, 'storage_failed');
    }
  } catch (e) {
    console.error('calendar-callback: storing refresh_token failed', e);
    return failRedirect(res, 'storage_failed');
  }

  res.statusCode = 302;
  res.setHeader('Location', '/main.html?calendar_connected=1#calendar');
  res.end();
};
