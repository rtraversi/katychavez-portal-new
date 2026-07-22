# Native Scheduling / Consult Booking Module — Build Plan

**Status:** SCOPED, ready to build. **Priority: START NEXT SESSION** (Rob bumped this above
Discovery Manager, 2026-07-11). **Branch:** `module/scheduling` off master.
**Migration range:** propose **1010–1049** (adjacent to Calendar = 1000; confirm free vs
`modules/registry.js` before writing).

Goal: clients/prospects see real availability and book a consult, inside the portal, tied to
the firm's Outlook calendars — replacing the Calendly idea with a native, integrated flow.

---

## Why native is viable (the plumbing already exists)
The Calendar module already provides, for both providers, with auto-refresh:
- `oauth_tokens` storage (Google + Microsoft), `_calendar-helpers.js` → `getValidGoogleToken` /
  `getValidOutlookToken`, `callGoogle`, `callGraph`; `calendar-events.js` reads/creates events.
So the availability engine only needs a **free/busy read** added:
- **Microsoft Graph:** `POST /me/calendar/getSchedule` (or `/calendarView`).
- **Google:** `POST /freeBusy`.
- ✅ Provider-string mismatch RESOLVED (verified 2026-07-11): migration
  `1002_calendar_outlook_provider.sql` already aligned the CHECK to `('google','outlook')`;
  all helper code + the Outlook callback consistently use `'outlook'`. Non-issue.
- ⚠️ The public booking endpoints are unauthenticated, but `getValidOutlookToken()` is keyed by
  user id — availability must look up the **attorney's** token via service role (by the consult
  type's provider `user_id`), never the caller's.
- Deployment prereq: each attorney must have connected Outlook in portal Settings → Calendar,
  or their availability can't be read.

## Confirmed decisions (Rob, 2026-07-11)
1. **Native module** (not MS Bookings) — Rob: real build time usually < scoping estimate.
2. **3 service types**: Free / Paid / Reduced-rate consult. (Whitney may add **estate law**
   consults Anita doesn't offer — handled naturally by per-attorney consult types, see #5.)
3. **No card-at-booking.** Staff can **send a payment link at any time** (Payload) for paid/reduced —
   booking never blocks on payment. Exact consult-billing mechanism ("how it works when NOT pulling
   unbilled time") is a SEPARATE future session; scope here just tracks payment status + sends a link.
   (Market note: if pay-at-booking is ever added, copy Clio's pattern — collect card in the booking
   flow, auto-unschedule if payment isn't completed.)
4. Firm is on **M365; both Anita & Whitney use Outlook** → availability comes from their Outlook calendars.
5. **Attorney-first booking flow** (Rob, 2026-07-11 scoping session): public page opens with
   **"Book with Anita" / "Book with Whitney"** buttons (both attorneys have their own followings —
   prospects usually come FOR one of them). Then: consult types **that attorney offers** →
   open slots from **that attorney's** free/busy → contact details + Turnstile → confirm.
   No union/round-robin/auto-assign logic in Phase 1. `consult_type_providers` already models
   per-attorney offerings; `appointments.user_id` = the chosen attorney.

---

## Data model (migration 1010–1049)

`consult_types` — service catalog
- `id`, `name`, `duration_min`, `fee_type text CHECK IN ('free','paid','reduced')`,
  `price_cents int DEFAULT 0`, `description`, `buffer_before_min`, `buffer_after_min`,
  `is_active bool`, `sort_order`. Which attorneys offer it → `consult_type_providers(consult_type_id, user_id)`.

`booking_settings` — firm-level (one row)
- `timezone default 'America/Chicago'`, `min_lead_hours` (e.g. 24), `max_days_out` (e.g. 30),
  `slot_granularity_min` (e.g. 30), default working-hours JSON.

`availability_rules` — per-attorney working windows (optional if using firm default)
- `user_id`, `day_of_week (0–6)`, `start_time`, `end_time`.

`appointments`
- `id`, `consult_type_id`, `user_id` (assigned attorney), `prospect_name`, `prospect_email`,
  `prospect_phone`, `starts_at timestamptz`, `ends_at timestamptz`,
  `status CHECK IN ('booked','cancelled','completed','no_show')`,
  `calendar_event_id` (event created on attorney calendar), `calendar_provider`,
  `matter_id uuid NULL` (link if converted), `payment_status CHECK IN ('none','link_sent','paid') DEFAULT 'none'`,
  `payment_link text`, `manage_token text` (self-service reschedule/cancel), `notes`, `created_at`.
- RLS: staff read/write via `can_read/can_write('scheduling')`. Public booking writes go through
  service-role API keyed by opaque token (no direct client RLS).

---

## Availability engine
For a chosen **attorney + consult type** over `[now+min_lead, now+max_days_out]`:
1. Generate candidate slots from working hours (per-attorney rules or firm default),
   step = `slot_granularity_min`, length = `duration + buffers`.
2. Pull **that attorney's** calendar **free/busy** for the window (token looked up by the
   attorney's `user_id` via service role); drop any slot overlapping busy time.
3. ~~Union across multiple providers~~ — NOT in Phase 1 (attorney-first flow means exactly one
   calendar per availability query). Union/round-robin only if a future flow needs it.
All math in `America/Chicago`, stored UTC. Watch DST (use explicit tz handling).

---

## Endpoints

**Public (new public surface — harden):**
- `GET  /api/booking/attorneys` — bookable attorneys (name, photo, blurb) for the pick-attorney step.
  Only expose attorneys with ≥1 active consult type; minimal fields, no user ids beyond an opaque slug.
- `GET  /api/booking/consult-types?attorney=` — active types **that attorney offers**.
- `GET  /api/booking/availability?attorney=&consult_type_id=&from=&to=` — computed open slots
  for that attorney.
- `POST /api/booking/book` — **Turnstile-gated + rate-limited**; re-check free/busy to avoid races,
  create calendar event on the attorney's calendar, insert `appointments` row, email confirmations
  (prospect + attorney), return confirmation + `manage_token`.
- `GET/POST /api/booking/manage?token=` — self-service cancel/reschedule (Phase 2).

> Security: this is a NEW public surface (Rob's lens). It only creates tentative calendar holds —
> lower-risk than e-sign — but MUST have **Turnstile** (already in the stack) + rate limiting + no
> enumeration + minimal PII. Call this out; it's the main risk of going native.

**Staff (portal, auth):**
- CRUD consult types + providers; edit working hours / booking settings.
- Appointments list (upcoming/past); mark completed/no-show; cancel.
- **"Send payment link"** (paid/reduced) → Payload adapter → email prospect → set `payment_status='link_sent'`.
- **"Convert to client"** → create client + matter, then fire existing `send-intake` (Phase 2 deep tie-in).

Register routes in `_worker.js`; register module (premium) in `modules/registry.js`.

---

## Frontend
- **Public booking page** (standalone, no portal login): **pick attorney** ("Book with Anita" /
  "Book with Whitney" buttons — photo + short bio blurb) → consult types that attorney offers →
  calendar of open slots → enter name/email/phone → Turnstile → confirm. Branded.
  Details step includes a "what's this regarding" **case-type dropdown sourced from the existing
  `case_types`/`practice_areas` tables (filtered by `enabled_practice_areas`)** — same list as the
  client-card dropdown (Rob, 2026-07-11). New offerings later (e.g. Whitney's estate law) = enable
  the practice area / add case-type rows on request; no code change. Store `case_type_id` on the
  appointment → free case-type hint for the Phase 2 booking→intake→matter conversion.
  (Add `case_type_id uuid NULL REFERENCES case_types(id)` to the `appointments` table.)
- **Staff:** Settings → Scheduling (types, providers, hours); Appointments page (list + actions).
- Booked events already surface in the existing Calendar page (same calendar).

---

## Reuse
Calendar OAuth + free/busy · Turnstile · rate-limiting · Payload adapter (payment link) ·
notification/email plumbing · intake flow (`send-intake`) for the convert-to-client tie-in.

---

## Phasing
**Phase 1 (MVP — the priority):**
- Migration + `consult_types` (seed 3: free/paid/reduced) + `appointments` + settings.
- Free/busy availability engine.
- Public booking page → creates Outlook event + confirmation emails (Turnstile + rate limit).
- Staff: manage consult types + working hours; appointments list; **send Payload payment link**; cancel.

**Phase 2:**
- Self-service reschedule/cancel via `manage_token`.
- 24h reminder email (cron — infra exists).
- **Booking → intake → matter** automation (the strategic prize; consult type → case_type hint).
- Multi-attorney round-robin / per-attorney availability rules; optional pay-at-booking.

---

## Open items — status as of 2026-07-11 scoping session
**Resolved:**
- ✅ Provider-string mismatch — non-issue; already fixed by migration 1002 (see above).
- ✅ Migration range — **1010–1049 confirmed free** (existing: 1000–1003, then 1050).
- ✅ Module tier — **premium** (Calendar is `premium: true` in registry.js; scheduling depends on it).
- ✅ Attorney selection — **attorney-first flow, prospect picks** ("Book with Anita"/"Book with
  Whitney" buttons). Decision #5 above.

**Settings-first principle (Rob, 2026-07-11):** everything firm-variable is a staff-editable
setting in Settings → Scheduling, NOT a build-time decision — consult types (name/duration/fee
type/price/buffers/active), per-attorney offerings, attorney photo+blurb, firm booking settings
(timezone/lead/max-out/granularity/default hours), per-attorney hour windows, reminder toggle +
hours-before. Only the FLOW is structural (attorney-first, no card-at-booking, hosted /book,
Turnstile). Ship sensible defaults; don't add settings beyond the existing schema in Phase 1.
This also makes the module drop-in for future client firms (template play, zero code fork).

**Still open (Rob to decide / ask Anita):**
- 📧 **Email to Anita & Whitney** (drafted in session) — DEMOTED from blocker to initial data
  entry by the settings-first principle: their answers (types/prices/durations/hours, incl.
  Whitney's possible estate-law consult) just seed rows they can edit themselves later.
- ✅ Public page location — **RESOLVED (Rob, 2026-07-11)**: hosted on the portal worker at a
  public route (e.g. `portal.divorcedifferently.com/book`, e-sign-token-page pattern). Context:
  Rob does NOT manage the firm's main website — the booking page must be something their website
  builder can simply **point to**. Deliverable to the web person = **a URL** for the "Book a
  Consultation" button (industry-standard hosted-page pattern, zero integration on their side).
  Concrete handoff artifact = a **copy-paste HTML button snippet** (styled `<a>` → the /book URL)
  the web builder can drop anywhere on the site.
  Fast-follow: an `<iframe>` embed snippet for inline embedding (test framing headers +
  Turnstile-in-iframe before offering it).
- Working hours Phase 1: firm default only, or per-attorney `availability_rules` override too
  (recommended: both — table exists anyway, override logic is small, and attorney-first flow +
  "their own followings" suggests they'll want different windows).
- Reminder email: market treats 24h reminders as table stakes (no-show reduction is the #1 pitch
  of every competitor) — consider pulling from Phase 2 into Phase 1 (cron infra exists).
- Consult-billing specifics deferred to a separate session (Rob, decision #3).
