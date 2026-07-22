# FreshBooks Connect — Scope & Build Plan (next session)

**Goal:** connect the portal's billing module to Scroggins & Savage's FreshBooks so Anita can pull unbilled time entries and push invoices from the portal.

**Status when scoped (2026-07-10, session #10):** FreshBooks auth investigated. The existing `FreshbooksAdapter` was written for a **static long-lived API token**, but **FreshBooks is OAuth 2.0 now** (long-lived tokens are legacy/de-emphasized). Rob is creating the OAuth app in the FreshBooks Developer Hub. This doc is the build plan to make the adapter actually work against OAuth. **Nothing is built yet beyond the token-based adapter shell.**

---

## The decision: OAuth 2.0, not a static token

Confirmed via FreshBooks docs:
- **Access tokens expire after 12 hours** → cannot paste a single token.
- **Refresh tokens ROTATE on every use** — each refresh returns a brand-new refresh token and *immediately invalidates the old one*; only one refresh token is alive per user per app at a time. (This is stricter than Dropbox/Google, whose refresh tokens are stable.)

Sources: https://www.freshbooks.com/api/authentication , https://www.freshbooks.com/api/get-authenticated-on-the-freshbooks-api

**Consequence:** we must (1) run a real OAuth connect flow, (2) store the tokens, and (3) on every refresh, **persist the newly-returned refresh token atomically** — or the connection dies after one refresh cycle.

---

## What Rob is collecting NOW (in the FreshBooks Developer Hub)

From the OAuth app he's creating:
- **Client ID** → `FRESHBOOKS_CLIENT_ID`
- **Client Secret** → `FRESHBOOKS_CLIENT_SECRET` (worker **secret**)
- **Redirect URI** (enter this in the app):
  ```
  https://portal.divorcedifferently.com/api/freshbooks-oauth-callback
  ```
  (Will 404 until the callback route ships — fine for now.)
- **Scopes** — grant at minimum: user profile read, accounting read+write (clients + invoices), time-tracking read. Refine to FreshBooks' actual scope names at build time.

---

## Existing infra we REUSE (don't rebuild)

The calendar integration already implements this exact OAuth shape — mirror it:
- **`oauth_tokens` table** (verified present on SSL `xdzgkagyfiauyfxbbdxv`): `id, user_id, provider(text), access_token, refresh_token, token_expiry, account_email, created_at, updated_at`, unique on **(user_id, provider)**. FreshBooks becomes `provider = 'freshbooks'`. **No new table needed.**
- **`oauth_state` table** — CSRF state (`state, user_id, expires_at`). Reuse verbatim.
- **Pattern files to clone:**
  - `functions/api/calendar-oauth-url.js` → generate authorize URL + insert `oauth_state`.
  - `functions/api/calendar-oauth-callback.js` → validate/consume state, exchange code, `upsert` into `oauth_tokens` on conflict `(user_id, provider)`.
  - `functions/api/_calendar-helpers.js` → the "get a valid access token, refresh if within 60s of expiry, update the row" helper.

⚠️ **The ONE thing the calendar helper does NOT do that FreshBooks REQUIRES:** the calendar refresh does `.update({ access_token, token_expiry })` only — it never rewrites `refresh_token` (Google's is stable). **The FreshBooks helper MUST also write back the new `refresh_token` on every refresh**, or the next refresh 400s.

---

## Build checklist (next session)

1. **`functions/api/freshbooks-oauth-url.js`** — Owner/Attorney-gated. Build the authorize URL, store `oauth_state`. Authorize endpoint (verify): `https://auth.freshbooks.com/oauth/authorize?client_id=…&response_type=code&redirect_uri=…&scope=…`.
2. **`functions/api/freshbooks-oauth-callback.js`** — validate state → POST to token endpoint (verify: `https://api.freshbooks.com/auth/oauth/token`, **JSON body** — FreshBooks uses `application/json`, unlike Google's form-encoded — `grant_type=authorization_code`, client_id, client_secret, code, redirect_uri) → upsert `oauth_tokens` (`provider='freshbooks'`, store access_token + refresh_token + token_expiry from `expires_in`). Then call `GET /auth/api/v1/users/me` to capture **account_id** + **business.id** and persist them (see open question on where).
3. **Rework `functions/api/_adapters/billing/freshbooks.js`:**
   - Constructor takes the admin Supabase client (not a static `env.FRESHBOOKS_ACCESS_TOKEN`).
   - Add `_getValidToken()` — load the `freshbooks` row, return `access_token` if >60s from expiry, else refresh (`grant_type=refresh_token`) and **persist BOTH the new access_token AND the new refresh_token** + new expiry.
   - `_request()` calls `_getValidToken()` for the Bearer header before each call.
   - Keep the existing accounting/time-tracking methods; just swap the token source.
4. **`freshbooks-status.js` + `freshbooks-disconnect.js`** (optional, mirror `calendar-status.js`/`calendar-disconnect.js`) — for a "Connected ✓ / Disconnect" control in billing settings.
5. **Settings UI** — a "Connect FreshBooks" button in billing settings that hits `freshbooks-oauth-url` and redirects; show connected state via `freshbooks-status`.
6. **Register routes** in `_worker.js`.
7. **Env/secrets on `savagelaw-v2`:** `BILLING_PROVIDER=freshbooks`, `FRESHBOOKS_CLIENT_ID`, `FRESHBOOKS_CLIENT_SECRET` (secret), `FRESHBOOKS_REDIRECT_URI`. `FRESHBOOKS_ACCOUNT_ID`/`FRESHBOOKS_BUSINESS_ID` — either set as vars or (better) auto-captured at callback (open question).
8. **Tests** — add route tests to the Vitest suite (mirror calendar-oauth test coverage); mock the token endpoint incl. the rotating-refresh persistence.

---

## The key risk: rotating refresh token (single-flight)

Because FreshBooks invalidates the old refresh token the instant a new one is issued, **two concurrent requests that both refresh will kill each other** — one persists a refresh token the other already invalidated → connection broken until re-connect.

Mitigations to implement:
- **Refresh rarely/proactively:** access token lives 12h, so at most ~2 refreshes/day. Refresh only when <60s from expiry.
- **Single-flight guard:** on refresh, do an optimistic-concurrency update (`update … where token_expiry = <the value we read>`); if 0 rows updated, another request already refreshed — re-read the row and use its fresh access_token instead of refreshing again.
- Portal billing calls are low-volume and mostly admin-triggered, so collisions are rare — but the guard makes it safe.

---

## Open questions / decisions for next session

1. **Per-firm vs per-user connection.** Calendars are per-user (each user connects their own). FreshBooks should be **one firm-level connection**. `oauth_tokens` is keyed on `(user_id, provider)` — options: (a) store under the connecting Owner's `user_id` and have the adapter load "the one freshbooks row" regardless of caller; (b) use a fixed NIL/sentinel `user_id` for firm-level rows. Pick (a) for v1 (simplest), note the assumption.
2. **Where to store `account_id` / `business_id`.** Auto-capture at callback from `/users/me` and store in `firm_settings` (or add nullable `account_id`/`business_id` columns to `oauth_tokens` — one tiny additive migration) — vs. just setting them as env vars. Auto-capture is cleaner; env vars are faster. Decide at build.
3. **Scope names** — confirm FreshBooks' exact scope strings from the app config screen.
4. **Migration?** Likely **none** if we reuse `oauth_tokens` + `oauth_state` and put account/business IDs in env or `firm_settings`. Only a small additive migration if we add columns to `oauth_tokens`.
5. **Client email matching** (carries over from the token-based scope): the adapter matches portal client → FreshBooks client **by email**. Spot-check that S&S client emails match between the two systems, or invoice creation throws "client not found."
6. **`Api-Version` header** — current adapter pins `alpha`; verify that's still correct at build.

---

## Endpoints to verify at build (don't trust from memory)
- Authorize: `https://auth.freshbooks.com/oauth/authorize`
- Token (JSON body): `https://api.freshbooks.com/auth/oauth/token`
- Identity: `GET https://api.freshbooks.com/auth/api/v1/users/me`
- Accounting base: `https://api.freshbooks.com/accounting/account/{accountId}/…`
- Time tracking base: `https://api.freshbooks.com/timetracking/business/{businessId}/…`
