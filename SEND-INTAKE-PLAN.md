# Send Intake — Build Plan

**Status:** ✅ Built on the template (all 111 Vitest tests green). Pending: apply migration 1225 + `wrangler deploy` to the sandbox, then click-test. Ports to SSL per normal workflow after sandbox sign-off. Scoped for SSL / family-law.

## Deploy / test steps (sandbox first)
1. **Apply migration `1225_send_intake.sql`** to the sandbox DB (adds `intake_token`, `intake_sent_at`, `intake_expires_at` to `matters`). You run this manually — I don't have sandbox Supabase access.
2. **`npx wrangler deploy`** (no `build-config.js` needed unless you're also changing `TURNSTILE_SITE_KEY`).
3. **For the email to actually send:** `RESEND_API_KEY` and a correct `PORTAL_URL` must be set on the sandbox Worker (the emailed link is `PORTAL_URL/intake?token=…`). If `RESEND_API_KEY` is unset the send no-ops and just logs — the token is still created.
4. **Optional CAPTCHA:** `npx wrangler secret put TURNSTILE_SECRET_KEY` to turn on the Turnstile check on the public form. Unset = form still works, check skipped.
5. **Try it:** open a client with a matter → **Send Intake** → open the link → fill → submit → confirm the data lands on the client card and the button flips to "Intake completed."

**Files:** migration `1225`; `functions/api/{send-intake,intake-public-load,intake-public-submit}.js`; `notifyIntakeRequest` in `_notifications.js`; `intake.html` + `js/intake-public.js`; routing in `_worker.js`; card button in `pages/clients/detail/`.
**Goal:** Let a firm send a client a fill-in-the-blank intake **webform via email — no portal account required.** Answers flow into the existing client card. Portal invite stays a separate, later step the firm chooses when (and if) to take the client on.

---

## Why

Today the only way a client fills in intake is to (a) be invited to the portal, (b) create an account, (c) log in, then (d) find the Case Intake tab. That's a lot of friction up front, and the firm can't even see the form themselves. Result: SSL is resistant to using it.

**Send Intake removes the account step.** One button → client gets an email → clicks a link → fills the form → done. If the firm later decides to bring them onto the portal, they invite them then, and the already-submitted intake is just there.

---

## Client experience

1. Client receives a branded email from the firm: *"[Firm] has requested some information about your case. Please complete your intake form."* + a button.
2. Clicking opens a standalone, branded page (no login) with the intake form — the **same** family-law sections that exist today (opposing party, marriage, children, finances), auto-showing/hiding by case type.
3. Client fills it in and submits.
4. Confirmation screen: **"Thank you. Your intake has been submitted to [Firm]."** (Deliberately generic — promises nothing about next steps. That's Anita's call to communicate.)
5. The link locks after submit and **expires after 14 days** regardless.

*Sensitive fields (SSN, driver's license) are excluded from this form, exactly as they are today — those stay on the firm's encrypted pathway.*

## Firm experience

- New **"Send Intake"** button on the client/matter card (staff-only — same permission as "Invite to Portal").
- After sending, the card shows status: **"Intake sent Jul 8 · not yet completed"** → flips to **"Intake completed Jul 9"** once submitted.
- A **Resend** action re-sends the email and **issues a fresh link** (the old one stops working).
- A **Preview intake** button opens the exact form the client sees, in sample mode — so the firm can finally *look at it* before sending. (This also solves the "we can't see it" complaint.)
- "Invite to Portal" is unchanged and independent — use it whenever the firm decides the client should have a portal account.

---

## Decisions locked

| Decision | Choice |
|---|---|
| Link lifespan | **14 days**, then expires |
| Resend behavior | **Rotates the token** — old link dies |
| Post-submit message | **"Thank you. Your intake has been submitted to [Firm]."** (firm name from config; no promises) |
| Bot protection | **Turnstile** on the public submit endpoint |
| Sensitive fields | Excluded (SSN/DL stay on encrypted path) |
| Data destination | **Existing structured tables** — answers land in the client card like today |

---

## Technical scope (appendix)

Everything below reuses primitives already in the codebase — no new infrastructure.

- **Migration:** add `intake_token uuid`, `intake_sent_at timestamptz` to `matters` (already has `intake_submitted_at`). Status is derivable; no new table for MVP.
- **Public access:** token-in-URL model, identical trust pattern to the existing unauthenticated iCal feed (`calendar-ical-feed.js`).
- **Endpoints (~3):**
  - `send-intake` (auth, staff-only) — generate/rotate token, stamp `intake_sent_at`, email link. Mirrors `invite-client.js` guards.
  - `intake-public-load?token=` (no auth) — resolve matter/client context + case type for the form.
  - `intake-public-submit` (no auth, Turnstile-gated) — validate token + expiry, write to the existing intake tables via admin client, set `intake_submitted_at` (lock).
- **Page:** new standalone route `/intake/<token>` reusing the current intake form UI + `applySectionVisibility(case_type)`.
- **Email:** one new `notifyIntakeRequest()` in `_notifications.js` (Resend, branded template already exists).
- **Card UI:** "Send Intake" / "Resend" / "Preview intake" buttons + status line on the client/matter detail page.

**Explicitly out of scope** (deferred): the full field-level form builder (Option B), any immigration-specific intake, and any messaging that promises the client a specific next step.

---

## Open for Anita

- Should staff get an **auto-notification when an intake is submitted** (in-app and/or email)? Easy either way — default would be an in-app notice on the client card.
- Confirm the family-law section set matches how SSL actually intakes (vs. Whitney's original form) — this is the "review the existing form" conversation, and the Preview button makes it concrete.
