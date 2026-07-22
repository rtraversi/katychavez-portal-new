# FreshBooks-First Invoice Flow — Scope / Build Plan

**Status: 🟢 BUILDING (un-pinned 2026-07-16).** Anita has decided she wants to
compose and finalize all billing/invoicing directly in FreshBooks going forward.
The portal's job becomes: mirror what's in FreshBooks, attach the Payload trust
pay-link, mark it Sent in FB, and give the client a way to view the invoice PDF
from their portal. Building Option A below on `module/fb-first-invoice`.

**Decisions confirmed with Rob (2026-07-16):**
1. **Which FB invoices to list** — ~~exclude drafts~~ **REVERSED 2026-07-17:
   include drafts.** The working model is "compose in FB, leave as draft, send
   from the portal" — a draft means ready-to-send, and Anita never touches FB's
   own Send button (which would email the client with no pay link). List
   everything not `paid` (`draft`/`sent`/`viewed`/`partial`/`overdue`); drafts
   get a Draft badge in the panel.
2. **Insert status** — mirror as `sent` immediately when attaching the pay link.
3. **Amount** — use FB **outstanding** balance (not full total), so a partially
   paid FB invoice only requests the remaining balance.
4. **Line items + PDF** — mirror FB line items as summary `'other'` items (per
   original lean), **and** fetch the invoice PDF and store it in R2 attached to
   the matter's Files (same pattern as other client documents), so the client can
   view/download it natively from the portal after it's sent. See new step 5 in
   the flow and the "PDF storage" subsection under New Work.

*(2026-07-14 history: this was originally pinned "not building" because Naomie
and Madison — not Anita — were doing the actual billing at the time, so the
portal composition surface (`feat/billing-review-batch`) was built instead. That
assumption has changed; Anita is now doing billing herself in FreshBooks.)*

**Original status:** scoped, not built. Design **Option A** (decided 2026-07-13).
**Target:** template → sandbox → SSL (Anita/Whitney).
**Branch:** `module/fb-first-invoice` off a clean `master`.

---

## Context — why

Anita composes her invoices **inside FreshBooks** (pure habit / muscle memory) and
does not want to rebuild them in the portal. But the portal owns the **trust
accounting** and the **Payload pay-link**. Today the portal is the *source* of an
invoice: `create-invoice` makes a local draft, `send-invoice` creates it in
FreshBooks, generates the Payload link, and pushes the link into FreshBooks notes.

FB-first **inverts that ordering**: the invoice already exists in FreshBooks; the
portal reads it, mirrors it locally, attaches a Payload **trust** pay-link, and
marks it **Sent** in FreshBooks so FreshBooks emails the client the link. When the
client pays, the **existing** webhook path posts the trust deposit and marks the
mirror invoice paid — all reused, no new payment plumbing.

Outcome: Anita keeps her FreshBooks habit; the portal still captures the trust
deposit and shows the invoice in Billing.

---

## The flow (Option A)

```
Billing ▸ "From FreshBooks"
  → portal lists Anita's UNPAID FreshBooks invoices        [new: FB adapter list + read endpoint]
  → Anita picks one
      → matter auto-links if the FB client maps to exactly one active matter,
        else Anita chooses (reuse the matter picker)
  → "Attach pay link & send"                               [new: mirror endpoint]
      1. read the FB invoice            (FB adapter getInvoice)
      2. insert a mirror portal `invoices` row (source='freshbooks',
         external_id=FB id, amount from FB, matter_id, account_type='trust')
      3. generate Payload TRUST link    (getPaymentAdapter().createPaymentRequest)
         → persist payment_link / payment_reference / payment_adapter
      4. write link into FB invoice + mark Sent  (adapter.sendInvoiceWithPaymentLink)
      5. fetch FB invoice PDF, store in R2, attach to matter's Files  [new]
         → client can view/download it from the portal, not just FreshBooks
  → client pays in FreshBooks email
      → Payload webhook → matches payment_reference → process_invoice_payment
        → trust deposit + invoice paid            [EXISTING, unchanged]
```

Steps 3–4 are byte-for-byte what `send-invoice.js:58-87` already does. Step 1's
"create in FB" is **skipped** — the FB invoice already exists (we only attach +
send). Step 5 is new — non-fatal if it fails (mirror + pay-link still succeed;
surface a warning so Anita/Rob know to retry or that the client won't see a
portal-hosted copy yet).

---

## What already exists — reuse map

| Need | Reuse | Location |
|---|---|---|
| FB HTTP + auth/token refresh | `_get`, `_getAllPages`, `_getValidToken` | `functions/api/_adapters/billing/freshbooks.js:217,319,332` |
| Attach pay-link + mark Sent in FB | `sendInvoiceWithPaymentLink(externalId, link)` (FB status 2 + notes) | `freshbooks.js:174-181` |
| Match FB client | `_findClientIdByEmail`, `_findClientIdByName` | `freshbooks.js:287-314` |
| Generate trust pay-link | `getPaymentAdapter(env).createPaymentRequest({invoiceId,amount,clientEmail,clientName,description,accountType:'trust'})` → `{paymentLink, requestId}` | `_adapters/payment/index.js:7`, `payload.js:67` |
| Trust vs operating routing | `invoices.account_type` (default `'trust'`) → Payload `processing_id` | migration `1526_invoice_trust_release.sql:27`; `payload.js:52` |
| Webhook reconciliation | matches `payment_reference` on `invoices`/`retainer_requests` → `process_invoice_payment` | `functions/api/invoice-payment-webhook.js:36-80` |
| Billing adapter factory | `getBillingAdapter(env)` (env-only; builds own admin client) | `_adapters/billing/index.js:6` |
| Admin Supabase client in an endpoint | `makeAdminClient(env)` | `functions/api/_helpers.js` |
| Adapter-aware read pattern (mirror the shape) | `get-unbilled-time.js` (calls adapter, returns `{items, source}`) | `functions/api/get-unbilled-time.js:20-42` |
| Invoice list / detail UI | `get-invoices.js`, `renderInvoiceList()`, `showDetail()` | `functions/api/get-invoices.js`; `pages/billing/billing.js:126-186,594-721` |
| Matter picker (searchable) | `matterPicker` widget | `pages/billing/billing.js` (New Invoice) |

`invoices.source` already allows `'freshbooks'` (migration `1503:16`);
`external_id`, `synced_at`, `account_type`, `payment_link`, `payment_reference`,
`payment_adapter` all exist. `UNIQUE (source, external_id)` is already a DB
constraint (`1200_trust_accounting.sql:146`) — duplicate mirrors are hard-blocked
at the database level already, no new index needed.

**One new migration IS needed for PDF storage (1534):** `documents.source` and
`document_versions.source` CHECK constraints (`1701_storage_sync_schema.sql:52,36`)
don't include `'freshbooks'` — only `portal|dropbox|google_drive|onedrive|idrive`.
Widen both. Also add `invoices.pdf_document_id uuid REFERENCES documents(id) ON
DELETE SET NULL` so the mirrored invoice can point at its stored PDF for the UI's
"View Invoice PDF" link (reuses the existing `/api/get-download-url` endpoint —
no new download plumbing needed).

---

## New work

### 1. FreshBooks adapter — two read methods
`functions/api/_adapters/billing/freshbooks.js`

- **`listUnpaidInvoices()`** — `GET /accounting/account/{accountId}/invoices/invoices`
  filtered to unpaid/partial (FreshBooks `v3_status` in `draft`/`sent`/`viewed`/`partial`
  / `overdue`; exclude `paid`). Use `_getAllPages` (ready) for pagination. Return a
  normalized array: `{ externalId, invoiceNumber, clientName, clientEmail, amount,
  outstanding, description, createdDate, dueDate, v3Status }`.
- **`getInvoice(externalId)`** — `GET …/invoices/invoices/{id}` (optionally
  `include[]=lines`). Return the same normalized shape + `lineItems:[{name, amount,
  quantity, unitCost}]`.
- **`getInvoicePdf(externalId)`** — ⚠️ **unverified against a live FreshBooks
  account** (researched 2026-07-16: no documented raw-PDF-bytes REST endpoint;
  the closest documented mechanism is appending `share_link&share_method=share_link`
  to the invoice GET once it's `Sent`, which returns a hosted URL — exact response
  field name and whether that URL serves `application/pdf` directly are both
  unconfirmed). Implementation is defensive: fetch the share link, check
  `Content-Type`, return `{ buffer, contentType }` on a real PDF or `null`
  otherwise — **never throws**, so a failure here can never block the pay-link/send
  flow. Confirm the real behavior during sandbox E2E and adjust field names then.

*(Mirror the return-shape discipline of `pullUnbilledTimeEntries` at `freshbooks.js:47`.)*

### 2. Endpoints
`functions/api/` — two, both `verifyAuth(request, env, 'write', 'billing')`:

- **`GET /api/fb-unpaid-invoices`** — calls `getBillingAdapter(env).listUnpaidInvoices()`.
  For each, attempt a **matter guess**: FB client email → portal `clients` (by email)
  → their **active** matters. Return `{ invoices:[{ ...fbInvoice, matter_guess:{id,
  case_number}|null, matter_options:[…] }], source:'freshbooks' }`. If no billing
  adapter (`getBillingAdapter` → null), return an empty list + a "not connected" flag
  so the UI can point to Settings.
- **`POST /api/mirror-fb-invoice`** — body `{ external_id, matter_id }`. Orchestrates:
  1. `admin = makeAdminClient(env)`; guard: reject if a `source='freshbooks'` invoice
     with this `external_id` already exists (return it instead — idempotent).
  2. `fb = getBillingAdapter(env); inv = await fb.getInvoice(external_id)`.
  3. Insert `invoices` row: `{ matter_id, description: inv.description, amount:
     inv.outstanding ?? inv.amount, source:'freshbooks', external_id, synced_at: now,
     account_type:'trust', status:'sent', sent_at: now, created_by }` (status/sent_at
     set directly since `invoices_manage_sent_at` only fires on UPDATE, not INSERT)
     + summary `invoice_line_items` (one row per FB line, `item_type:'other'`).
  4. Resolve client email/name from the **portal** matter→client (authoritative);
     fall back to `inv.clientEmail/clientName`.
  5. `link = getPaymentAdapter(env).createPaymentRequest({ invoiceId: row.id, amount:
     row.amount, clientEmail, clientName, description: row.description, accountType:
     row.account_type })`; update row `payment_link=link.paymentLink,
     payment_reference=link.requestId, payment_adapter=env.PAYMENT_PROVIDER`.
  6. `await fb.sendInvoiceWithPaymentLink(external_id, link.paymentLink)` (attach +
     FB status 2). Non-fatal on error (mirror the `send-invoice.js:80-87` try/catch),
     but surface a warning so Anita knows to resend from FB if it failed.
  7. `pdf = await fb.getInvoicePdf(external_id)` (never throws — see adapter note
     above). If a PDF came back: `r2Key = matters/${matter_id}/${documentId}/${invoiceNumber}.pdf`,
     `env.R2.put(r2Key, pdf.buffer, { httpMetadata: { contentType: 'application/pdf' } })`,
     insert a `documents` row (mirror `new-document-from-template.js` shape:
     `source:'freshbooks'`, `client_visible:true` — client should see it immediately,
     unlike a staff draft copy — `scan_status:'skipped'`, `doc_type:'financial'`,
     `uploaded_by: null`) + a `document_versions` v1 row, then set
     `invoices.pdf_document_id = document.id`. Non-fatal on any failure — log +
     surface a warning; the mirror/pay-link/send already succeeded.
  8. Return `{ invoice: <joined row incl. invoice_line_items> }` (same shape the UI's
     `showDetail` already consumes) + any warnings from steps 6–7.

*(Steps 5–6 are the same calls as `send-invoice.js:58-87`; consider extracting a small
shared `attachPayLinkAndSend(admin, env, invoiceRow, client)` helper used by both to
avoid drift — optional.)*

### 3. Billing front-end — "From FreshBooks" panel
`pages/billing/index.html` + `pages/billing/billing.js`

Add a panel the same way the others are wired (per the panel pattern):
- Toolbar button `#bl-fb-btn` ("From FreshBooks") next to `#bl-new-btn`
  (`index.html:15-26`).
- Panel `#bl-fb-panel` (`index.html`, `style="display:none"`).
- Ref in `billing.js:12-51`, a case in `showPanel()` (`billing.js:98-104`), nav
  handler near `billing.js:807-840` that calls a new `loadFbInvoices()` →
  `apiGet('/api/fb-unpaid-invoices')`.
- Render each unpaid FB invoice as a Docket register row: number, client, amount,
  date, a **matter** control (pre-filled with `matter_guess`; if none/ambiguous,
  reuse the `matterPicker` widget), and an **"Attach pay link & send"** button →
  `apiPost('/api/mirror-fb-invoice', {external_id, matter_id})`.
- On success: toast, `loadInvoices()`, `showDetail(data.invoice)` (reuse existing
  detail render — it already shows the Payment Link block + status).
- Empty / not-connected states point to **Settings ▸ Billing & Payments** (the
  existing connect card, `pages/settings/billing/`).

### 4. Tests
`test/` (Vitest in workerd) — mirror existing billing adapter tests:
- Adapter: `listUnpaidInvoices` filters out paid + paginates; `getInvoice` normalizes.
  Mock `_get`.
- `mirror-fb-invoice`: happy path (insert + link + mark sent), duplicate-guard returns
  existing, missing matter → 400, FB-send failure → still returns invoice with warning.
  Mock `getBillingAdapter`/`getPaymentAdapter`.

---

## Trust-routing & reconciliation specifics (do not deviate)

- **Route to IOLTA** via `account_type:'trust'` (default) → `createPaymentRequest`
  `accountType` → Payload `processing_id`. Do **not** invent a new routing flag.
- The mirror invoice **must** persist `payment_reference = link.requestId`. The
  webhook (`invoice-payment-webhook.js:36-43`) resolves the paid invoice **only** by
  `payment_reference`; without it the trust deposit never posts.
- Payment settled → `process_invoice_payment(p_invoice_id, p_transaction_ref)`
  (migration `1526:154`) marks paid + inserts the trust `'deposit'` atomically. No
  changes needed there.

---

## Guards / edge cases

- **Duplicate mirror:** before insert, check `invoices` for `source='freshbooks' AND
  external_id=?`; if found, return it (idempotent) rather than creating a second row +
  second Payload link. *(Optional: enforce with a partial UNIQUE index — small
  migration if we want it DB-hard.)*
- **Amount:** use FB **outstanding** when present, else total, so a partially-paid FB
  invoice requests only the balance.
- **Client email for Payload:** prefer the portal matter→client email (authoritative);
  fall back to the FB invoice client. If neither, block with a clear error.
- **No billing adapter / not connected:** `getBillingAdapter(env)===null` → the list
  endpoint returns not-connected; UI points to Settings.
- **FB mark-Sent failure:** non-fatal — the mirror + link still exist; warn Anita to
  resend from FB (or offer a "retry send" that re-calls `sendInvoiceWithPaymentLink`).
- **account_type:** Phase 1 hardcodes `'trust'` (Anita's trust-first config). A
  trust/operating choice can be added later, same lever.

---

## Deferred — Phase 2

- **Mark-Paid back in FreshBooks:** when the trust release / payment completes, push
  FB invoice → paid so FreshBooks and the portal agree. (Needs an FB adapter
  `markInvoicePaid(externalId)` + a hook off `process_invoice_payment` / the release
  flow.) Explicitly out of Phase 1.
- ~~Retainer→FreshBooks recording (old item #4)~~ **BUILT 2026-07-17 (toggled,
  default OFF):** a paid retainer can be auto-recorded in FreshBooks as a
  **Prepayment credit** under the client (`createPrepaymentCredit`, webhook
  hook, `firm_settings.fb_auto_prepayment` via migration 1535 + Settings ▸
  Billing toggle). Ships dark because the FB credit_notes 'prepayment' type is
  unverified live; while off, the retainer-paid staff email (also new
  2026-07-17) reminds the team to record it manually. Verify live → flip on.
- **Trust-shortfall / partial release (pain point 2026-07-17):** invoice $2,600
  vs $2,000 in trust. Design decided in discussion: Anita applies the client's
  prepayment credit **in FreshBooks** while composing; portal mirrors only the
  outstanding overage (already works). Remaining portal gap: a **partial trust
  release** (current `release_invoice_from_trust` is all-or-nothing full
  amount, one per invoice) so the applied-credit amount can be recorded
  trust→operating. NOT YET BUILT — Rob still deciding scope.

---

## Build order & verification

1. ☑ Branch `module/fb-first-invoice` off clean `master`.
2. ☑ Adapter methods + unit tests → `node --check`, `npm test` (freshbooks.js:
   `listUnpaidInvoices`, `getInvoice`, `getInvoicePdf`; `test/unit/freshbooks-invoices.test.js`).
3. ☑ `mirror-fb-invoice` + `fb-unpaid-invoices` endpoints + tests
   (`test/unit/mirror-fb-invoice.test.js`, `test/unit/fb-unpaid-invoices.test.js`).
   Also migration `1534_fb_first_invoice.sql` (documents/document_versions source
   CHECK widened to allow `'freshbooks'`; `invoices.pdf_document_id` added).
4. ☑ Front-end panel (`pages/billing/index.html`, `pages/billing/billing.js`) — built
   using only existing `.dk-*` / CSS-variable tokens (no hardcoded colors), matching
   the surrounding panels. **Not visually screenshot-verified in light/dark** — no
   Supabase backend is available in this environment to log in and drive the page;
   do that check as part of sandbox E2E below.
5. ☑ `npm test` green (280/280). Sandbox deploy is **Rob's step** (`build-config.js`
   + `wrangler deploy` — this session doesn't run deploys, per project convention).
6. ⏳ **Sandbox E2E (pending):** connect FreshBooks (Settings), create a test unpaid
   invoice in FB, open Billing ▸ From FreshBooks, mirror it, confirm: mirror row
   appears (`source='freshbooks'`), FB invoice shows the pay-link note + Sent status,
   the invoice PDF shows up in the matter's Files and is viewable from Billing detail,
   pay via the Payload link → webhook posts the **trust deposit** + invoice flips
   **paid**. **This is also where `getInvoicePdf`'s share-link mechanism gets its
   first real-world test** — confirm it actually returns a PDF; adjust the adapter's
   field names/query if FreshBooks' real response differs from the guess.
7. ⏳ Sign-off → SSL deploy-plan doc (client-rooted window, per the template→SSL workflow).

---

## Open questions for Anita — RESOLVED 2026-07-16

See "Decisions confirmed with Rob" at the top of this doc. All four are answered;
this section kept for history only.
