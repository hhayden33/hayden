# Google Calendar setup

One-time setup to connect the dashboard's Calendar section
([main.html](main.html)) to your real Google Calendar. Read-only —
this app can never create, edit, or delete anything on your calendar.

## 1. Google Cloud Console

1. Go to [console.cloud.google.com](https://console.cloud.google.com/) and
   create a new project (or pick an existing one you're happy to use for
   this — top-left project dropdown → **New Project**).
2. **APIs & Services → Library** → search **Google Calendar API** →
   **Enable**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External** (unless you have a Google Workspace org to
     pick Internal from — either works for a single-user app like this).
   - Fill in the required fields (app name, your email as support/contact).
   - Scopes: add `.../auth/calendar.readonly` (search "calendar" — pick
     the **read-only** one specifically, not the full `calendar` scope).
   - Test users: add your own Google account's email. While the app is in
     "Testing" mode (the default, and fine to leave it there for personal
     use), only accounts listed here can complete the consent screen.
4. **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Name: anything, e.g. "88YYDS Dashboard".
   - **Authorized redirect URIs** — add exactly:
     - `https://hayden-delta.vercel.app/api/calendar-callback` (production)
     - `http://localhost:3000/api/calendar-callback` (only if you run
       `vercel dev` locally on port 3000 — skip if you don't)
   - Click **Create**. You'll get a **Client ID** and **Client secret** —
     keep this tab open, you need both in step 3 below.

## 2. Supabase — one new table

Your refresh token needs somewhere durable to live between requests
(serverless functions don't keep memory between calls). This is a **new**
table, kept deliberately separate from the existing `app_state` table your
other trackers sync through — `app_state` is reachable by the public
anon key your frontend already ships (that's a known, documented,
separate issue in [SECURITY.md](SECURITY.md)); this new table is not,
by design, reachable by *any* key except the service-role one you're
about to create, which only ever lives as a Vercel env var and is never
sent to a browser.

In the [Supabase SQL editor](https://supabase.com/dashboard/project/itidzioouqjbwnyvekkw/sql/new)
for this project, run:

```sql
create table if not exists google_calendar_auth (
  id text primary key,
  refresh_token text not null,
  scope text,
  updated_at timestamptz not null default now()
);

alter table google_calendar_auth enable row level security;
-- No policies added on purpose: RLS enabled + zero policies means every
-- role is denied by default *except* service_role, which bypasses RLS
-- entirely. That's what makes this table safe to hold a refresh token
-- in, unlike app_state.
```

Then get your **service_role key**: Supabase dashboard → **Project
Settings → API** → under "Project API keys", copy the `service_role`
**secret** key (not the `anon`/`public` one — that's the one already in
[sync.js](sync.js), and it must never gain access to this table).

## 3. Vercel environment variables

Project → **Settings → Environment Variables**, add these 4 (Production —
and Preview/Development too if you use those):

| Name | Value |
|---|---|
| `GOOGLE_CLIENT_ID` | from step 1.4 |
| `GOOGLE_CLIENT_SECRET` | from step 1.4 — **never** put this in any frontend file |
| `GOOGLE_REDIRECT_URI` | `https://hayden-delta.vercel.app/api/calendar-callback` |
| `SUPABASE_SERVICE_ROLE_KEY` | from step 2 — **never** put this in any frontend file |

Redeploy (or just push any commit — Vercel redeploys on push) so the
functions pick up the new env vars.

## 4. Connect it

Open [main.html](main.html), scroll to the **Calendar** section, click
**Connect Google Calendar**, approve the consent screen. You'll land back
on the dashboard with your schedule showing. That's it — nothing to
enter, nothing to re-approve unless you revoke access from your
[Google Account's connected apps](https://myaccount.google.com/connections)
page.

## What this does and doesn't do

- Reads: your calendar list and events, next 7 days, refreshed at most
  every few minutes.
- Never writes anything back to Google.
- Multiple calendars: every calendar checked in your own Google Calendar
  sidebar is included and labeled with its real name/color — nothing
  hardcoded, nothing assumed.
- If you revoke access from Google's side, the dashboard shows a
  "reconnect" prompt rather than erroring silently.

## Same trust model as the rest of this app

This app has no login system anywhere ([SECURITY.md](SECURITY.md) says
so plainly). `/api/calendar-events` is protected the same way
`/api/claude.js` already is — an origin allowlist plus a per-IP rate
limit — which stops casual misuse but not someone who has the URL and
forges an Origin header. That's an accepted tradeoff already made
elsewhere in this codebase, not a new one introduced here; if you want
real per-request auth later, it needs the same login step the `app_state`
RLS fix in SECURITY.md is waiting on.
