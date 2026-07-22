# FreshBooks Billed-Time Dedupe — Plan

**Status:** scoped 2026-07-16, not built. Branch: `fix/fb-billed-dedupe`.

## Problem

The portal's unbilled-time list for FB-connected firms is read live from FreshBooks
(`billed=false`), but nothing ever consumes that pool:

- Portal invoice creation stores FB-pulled lines with `time_entry_id = null`
  (FB ids like `fb_344181434` aren't portal UUIDs — by design).
- The FB invoice we create uses plain lines (no time-entry reference), so
  FreshBooks never flips the entries' `billed` flag either.
- Result: **time already on a draft or sent invoice re-appears in the unbilled
  list** the next time anyone starts an invoice for that client.

Observed on SSL 2026-07-16: Gracie Everitt got two identical $80 drafts
(INV-0035 on 7/15 and INV-0040 on 7/16) carrying the same FB entry. If both are
sent, the client is double-billed. Voiding an invoice whose time is FB-sourced
is also a silent no-op portal-side — it "works" today only because the FB pool
never shrank in the first place.

## Phase 1 — portal-side dedupe (deterministic, the core fix)

Track which FB entries are on a live portal invoice and filter them out of the
pull. No dependence on FB API quirks; void/draft-edit release falls out for free.

1. **Migration `1533_line_item_external_entry.sql`**
   - `alter table invoice_line_items add column external_entry_id text;`
   - Partial index: `create index ... on invoice_line_items (external_entry_id) where external_entry_id is not null;`
   - Naming: store the provider-scoped id exactly as the UI sees it (`fb_<id>`)
     so it stays provider-agnostic (QuickBooks later: `qb_<id>`).

2. **`create-invoice.js`** — persist `item.external_entry_id` when it matches
   `/^[a-z]+_\d+$/` (same defensive posture as the existing `isUuid` guard).

3. **`update-draft-invoice.js`** — `add_items` persist it the same way.
   Removing a line deletes its row → entry is freed automatically.

4. **`get-unbilled-time.js`** — after the adapter pull, drop entries whose id
   is in:
   ```sql
   select li.external_entry_id
   from invoice_line_items li
   join invoices i on i.id = li.invoice_id
   where li.external_entry_id is not null
     and i.status <> 'void'
   ```
   Filter lives in the route (not the adapter) so the adapter stays a pure FB
   client. Void → invoice excluded → entries reappear. This makes **void of
   FB-sourced time actually work**, not work-by-accident.

5. **UI `pages/billing/billing.js`** — include `external_entry_id: entry.id`
   for FB-sourced entries in the create/update payloads (portal entries keep
   using `time_entry_id`).

6. **Tests** (Vitest, extend `test/unit/`): create→pull filters entry;
   void→pull shows it again; draft line removal frees it; portal-native
   entries unaffected; malformed external ids rejected.

### Nice-to-have (small, same branch)
Duplicate-draft guard in the UI: when opening New Invoice for a matter that
already has a non-void invoice this month, show a warning banner with a link
to the existing one. Cheap insurance even after the filter exists.

## Phase 2 — FreshBooks writeback (optional, verify first)

FB's docs mark `billed` **read-only** on time entries, but invoice lines accept
an undocumented `modern_time_entries` field (plus `modern_project_id`) — almost
certainly how FB's own UI links time to invoices and flips `billed`.

- Sandbox experiment: create an FB invoice with `modern_time_entries` on a
  line; confirm (a) the entry's `billed` flips to true, (b) deleting/voiding
  the FB invoice flips it back, (c) totals/PDF unaffected.
- If verified: attach entry ids at `createInvoice()` time in the adapter, and
  make portal void also delete/void the FB invoice (today FB-side cleanup is
  manual). If not verified: skip — Phase 1 already prevents double-billing;
  FB's own reports can be tidied with FB's bulk "mark as billed" UI action.

## SSL backfill (July run already sent without links)

Invoices sent 7/15–7/16 have no `external_entry_id`, so their FB entries stay
pull-able even after Phase 1 deploys. One-time mitigation, pick one:

- **Recommended:** staff uses FreshBooks' bulk **"mark as billed"** on all July
  time after the run completes — uses FB's own feature, also fixes FB reports.
- Not recommended: fuzzy backfill matching description+date+client (risky).

Until then the working rule for staff stands: **one invoice per client per
run; void the old one before re-creating.**

## Deploy order

Template: branch → tests green → merge → sandbox verify (FB sandbox pull with
one linked entry). Then SSL: migration 1533 via MCP, sync script picks up the
four touched files + billing.js, Rob deploys. KCL: rides the next reconcile
(no FB adapter configured there, migration is harmless).
