# Security — 88YYDS

Last audit: 2026-08-26. Stage 1 (report) and most of Stage 2 (fixes) are
done; one item (RLS) is a real architecture decision waiting on you.

## Fixed tonight

| # | Finding | Fix | Commit |
|---|---|---|---|
| 2 | `substances`/`profile` synced to Supabase alongside ordinary tracker data | Split into `po_water_local_v1` (never synced) vs `po_water_v1` (synced). In-UI note in Settings explaining the split. | `fa1000e` |
| 3 | All 9 pages loaded `@supabase/supabase-js@2` unpinned from jsDelivr | Vendored the exact resolved version (2.112.4) into `vendor/`; confirmed it had already silently drifted from 2.112.3 since this app was last touched | `564eca6` |
| 4 | No security headers anywhere | `vercel.json`: X-Content-Type-Options, Referrer-Policy, Permissions-Policy, HSTS site-wide; a real `script-src 'self'` CSP (no `unsafe-inline`) scoped to `main.html`, which is the one page with zero inline scripts | `bb070b2` |
| 5 | Six near-identical `escape()`/`escapeHtml()` copies, three of them named `escape` (risking silent fallthrough to the browser's deprecated global of that name) | One shared `escape.js`, all six call-site sets updated, one latent bug fixed in the process (finance.html rendered `"undefined"` literally for null fields) | `8ab06ba` |
| 6 | Water settings JSON import passed the parsed file through nearly unfiltered | Whitelist validator (`sanitizeImport`) — known fields only, type-checked, `__proto__`/`constructor`/`prototype` stripped at every level, tested against a deliberately hostile payload | `ce28b63` |
| 7 | No rate limit on `/api/claude` — real money per call | In-memory: 20/10min per IP, 200/day global hard ceiling | `2fd1b25` |
| 8 | Briefing payload sent task titles (text) to the API | Dropped to a count only — flagged as an open question in the audit, defaulted to the more conservative option since it wasn't explicitly answered | `5984e57` |

## Deliberately accepted, not fixed

- **Device-level exposure** (`localStorage` plaintext, unencrypted JSON
  export) — your call: "my laptop is always on me, I'll never leave it
  unlocked around others." No action taken; this is a documented,
  explicit risk acceptance, not an oversight.
- **`style-src 'unsafe-inline'`** in main.html's CSP — 16 inline
  `style=""` attributes (mostly `display:none` toggles) would need
  migrating to CSS classes to close this. Inline styles are a much
  smaller attack surface than inline scripts (which *are* fully locked
  down), so this was a pragmatic call rather than blocking the whole
  header on a lower-value cleanup.
- **No CSP on the other 8 pages** (index/finance/gym/goals/po-water/
  template/running/todo) — each still has 1-4 inline `<script>` blocks
  of real logic. They get every header that doesn't depend on that
  (nosniff, Referrer-Policy, Permissions-Policy, HSTS) via the site-wide
  rule, but a strict script-src would break every one of them. Same
  state main.html was in before Phase 2 — cleanable, not done tonight.
- **`automation/garmin-cron-sync.mjs`'s credential source** — still not
  fully confirmed. No `.env` file, no plist env vars, no shell export
  found anywhere; its error logs show zero auth failures, suggesting it
  reads the `~/.garmin-mcp/` OAuth token cache, but this wasn't traced
  to certainty. Worth a direct look when convenient.
- **In-memory rate limiting's cold-start gap** — documented in
  `api/claude.js`'s own comments. Stops the common case, not a
  determined distributed attacker. A KV-backed limiter would close this
  fully but adds a paid dependency this app doesn't otherwise have.

## Still open — needs your decision

**Finding #1: Supabase RLS.** Confirmed live (not theoretical) during the
Stage 1 audit — an unauthenticated GET with only the public anon key
returned every row in `app_state`. This is the one your original brief
called "the whole job until it's closed," and it's still open, because
the only fix that actually works has a real usability cost:

This app has **no authentication anywhere**. `auth.uid()`-scoped RLS
policies — the standard, actually-secure fix — require every device to
be signed in as the *same* real user, not an anonymous per-device
session (anonymous auth would give each device a different `uid`,
breaking cross-device sync entirely, which defeats the point). That
means adding a real login step (magic-link email is simplest, no
password to manage or leak) that you'd complete once per device.

If you want that:

```sql
-- Run in the Supabase SQL editor, in order.

ALTER TABLE app_state ADD COLUMN user_id uuid REFERENCES auth.users(id);

ALTER TABLE app_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select own rows" ON app_state
  FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "insert own rows" ON app_state
  FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "update own rows" ON app_state
  FOR UPDATE USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "delete own rows" ON app_state
  FOR DELETE USING (auth.uid() = user_id);

-- After you've signed in once via the app and know your auth.uid()
-- (Supabase dashboard → Authentication → Users), backfill existing rows:
-- UPDATE app_state SET user_id = '<your-uid>' WHERE user_id IS NULL;
```

That SQL alone isn't enough — `sync.js` would need a login flow added
(magic-link email UI, session persistence, `user_id` included on every
upsert) before the policies above would let the app keep working rather
than just locking everyone out, yourself included. That's real,
undone work, not a config toggle.

**To verify it's closed once both sides are done**, repeat the exact
read-only test from the Stage 1 audit in a browser with no session:

```
curl "https://itidzioouqjbwnyvekkw.supabase.co/rest/v1/app_state?select=key,updated_at" \
  -H "apikey: <the anon key>" \
  -H "Authorization: Bearer <the anon key>"
```

Today that returns all 12 rows. After a correct fix, it should return an
empty array or a permission error — anon key alone, no session, no data.

## Re-audit checklist for future changes

- Any new `initCloudSync` channel: does its payload contain anything
  more sensitive than a checkbox? If so, it inherits finding #1's
  exposure the moment it's registered.
- Any new `innerHTML`/`insertAdjacentHTML` with a stored or fetched
  string: route it through `window.escapeHtml` from `escape.js`, or use
  `textContent` if the content isn't actually markup (the stronger
  guarantee — see `briefing.js`/`countdown.js`/`nudge.js` for the
  pattern).
- Any new external `<script src="https://...">`: vendor it or pin with
  SRI — check first whether the CDN even supports SRI on that URL
  pattern (jsDelivr's `@major` aliases explicitly don't).
- Any new file-import feature: whitelist-validate, don't pass the parsed
  object through — see `sanitizeImport()` in `po-water.html` for the
  pattern.
- Any new page: does it still have inline `<script>` blocks? If yes, it
  can't get a strict CSP without either migrating them out (Phase-2-style)
  or accepting `unsafe-inline` for that page specifically.
