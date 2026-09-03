// =============================================================
// Step 1 of the Google Calendar OAuth flow. A plain top-level GET link
// (not fetch — Google's consent screen has to be a real navigation)
// that redirects the browser to Google's consent screen.
//
// calendar.readonly only: this dashboard never creates, edits, or
// deletes anything on your calendar, it only displays it. access_type
// =offline + prompt=consent on every run guarantees a refresh_token
// comes back every time (Google only issues one on the *first* consent
// otherwise), which matters here because reconnecting after a revoke
// needs a fresh one too.
// =============================================================
'use strict';

const crypto = require('crypto');

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const SCOPE = 'https://www.googleapis.com/auth/calendar.readonly';
const STATE_COOKIE = 'gcal_oauth_state';
const STATE_MAX_AGE_S = 600; // 10 minutes — plenty for a consent screen, short-lived on purpose

module.exports = async function handler(req, res) {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;

  if (!clientId || !redirectUri) {
    console.error('calendar-auth: GOOGLE_CLIENT_ID or GOOGLE_REDIRECT_URI not set');
    res.setHeader('Content-Type', 'text/plain');
    return res.status(502).send('Calendar integration is not configured yet (missing env vars).');
  }

  // CSRF protection: a random value we can only have set, stored both in
  // the redirect URL Google bounces back and in an httpOnly cookie only
  // this browser holds. calendar-callback.js rejects the exchange if
  // they don't match.
  const state = crypto.randomBytes(24).toString('base64url');
  res.setHeader('Set-Cookie',
    STATE_COOKIE + '=' + state +
    '; Max-Age=' + STATE_MAX_AGE_S +
    '; Path=/api/calendar-callback; HttpOnly; Secure; SameSite=Lax'
  );

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state: state,
  });

  res.statusCode = 302;
  res.setHeader('Location', GOOGLE_AUTH_URL + '?' + params.toString());
  res.end();
};
