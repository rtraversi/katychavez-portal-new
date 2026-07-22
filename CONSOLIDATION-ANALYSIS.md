# Portal Bloat / Consolidation Analysis — 2026-07-17

Requested deliverable from the 7/17 session: analysis + proposal, no code. Three axes: pare back
billing options, consolidate migrations, separate SSL/Anita-specific functionality from the
generic template. A repo-hygiene section and a proposed decision list follow.

---

## 🔴 0. Urgent bug found during the audit (fix before anything else)

**The FB-first "From FreshBooks" panel is dead on master — and therefore on SSL's live deploy.**

- `pages/billing/billing.js:1215` calls `/api/fb-unpaid-invoices`; `:1287` calls `/api/mirror-fb-invoice`.
- Neither route is registered in `_worker.js`'s `routes` table (dispatch is exact-match,
  `_worker.js:375`). Unmatched `/api/*` falls through to static assets → 404.
- Every other FB-first piece IS wired (`/api/update-draft-invoice`, `/api/release-invoice-trust`,
  the four `/api/freshbooks/*` OAuth routes).
- Tests pass (287/287) because they import the handler functions directly — route registration has
  no test coverage.
- The sandbox "FB panel errors because no FB access (expected)" observation from 7/17 was almost
  certainly these 404s, misattributed.
- **Impact: the Naomie live test will fail at step 1 (the unpaid-drafts list won't load).**

Fix = two imports + two route entries in `_worker.js`, re-run sync script, redeploy SSL.
Also worth adding: a small test asserting every `functions/api/*.js` referenced by pages is
present in the routes table (would have caught this).

---

## 1. Billing pare-back

### The current surface (what a firm can configure / what code paths exist)

Fifteen distinct billing workflows implemented; the significant overlaps:

| # | Redundancy | Detail |
|---|---|---|
| A | **Two full invoice-authoring paths** | Portal-native composition (`create-invoice.js`, `get-unbilled-time.js`, ~530 lines of `billing.js` UI) vs FB-first mirror (`mirror-fb-invoice.js`, `fb-unpaid-invoices.js`, migrations 1533/1534). FB-first was decided 7/16 to supersede portal-native for SSL — but both remain, and the new one is the unwired one (§0). |
| B | **Two mechanisms for the same monthly admin fee** | `recurring_charges` cron (1525/1528, `process-recurring-charges.js`, half of the Settings ▸ Rates UI) vs the `admin_fee` expense category (1527) that Anita actually uses by hand. One should go. |
| C | **`operating` vs `trust` account selector with no live variation** | `account_type` appears on invoices, expenses, recurring_charges + the "Collected via" select — SSL is trust-first so it's always `trust` (and three endpoints hardcode `'trust'` anyway). |
| D | **`fb_auto_prepayment` shipped dark** | Default off, mechanism never run live, calls an unverified FB API. A Settings toggle for a feature nobody can use yet. |
| E | **Two FreshBooks integration styles that don't co-exist cleanly** | Pull-FB-time-into-portal-invoices (`billing_identity_map`, external-entry dedupe) vs mirror-FB-invoices. Each exists only to serve one of the two authoring paths in A. |

### Proposal: collapse to one explicit "billing mode" per firm

Add a single `firm_settings.billing_mode` enum: **`portal`** | **`freshbooks_first`** (| future
`quickbooks`). Everything follows from it:

- `portal` → New Invoice UI, unbilled-time pull, FB time import. Hide the From-FreshBooks panel.
- `freshbooks_first` → From-FreshBooks panel, mirror/update-draft/PDF flow. Hide New Invoice
  composition (keep view/resend/void/payment tracking).
- Retire per-firm the machinery the mode doesn't use, rather than deleting either path — both are
  needed (SSL = freshbooks_first; a firm without FB = portal).
- Fold the admin-fee decision in: keep the `admin_fee` expense category (simple, matches actual
  use), demote the recurring-charges cron to premium/off-by-default or remove its Settings UI
  until a firm actually wants automated recurring billing. (The cron is generic and harmless dark;
  the UI real estate is the bloat.)
- Keep: billing increment (generic, well done), per-person rate resolver (generic, well done),
  no-charge lines, fixed retainer requests. Open-amount retainers (1529) = keep, tiny.
- `fb_auto_prepayment`: leave dark; consider hiding the Settings toggle until the FB API is
  verified live (the amber "record manually" email covers the workflow meanwhile).

Net effect: each firm sees ONE invoice workflow and roughly half the current Settings ▸ Billing
surface, without deleting capability.

## 2. Separating SSL/Anita-specific from the template

Ranked by how deeply it's woven in:

**Easy — pure one-off files (move out of the repo, zero code risk):**
- 17 `scroggins-sync-*.ps1` at repo root (each hardcodes `C:\Sites\scrogginssavage`, SSL Supabase,
  `savagelaw-portal-prod`), plus `kcl-sync.ps1`, `freshbooks-sync.ps1`.
- ~14 client-specific deploy/port docs at root (`SCROGGINS-*`, `*-SSL*.md`, `KCL-SYNC-DEPLOY.md`…).
- Proposal: `deploy/ssl/`, `deploy/kcl/` folders (or move to the client clone repos entirely) —
  template root keeps only template docs.

**Easy — scrub comments/strings:**
- Live SSL Payload merchant ID in a comment (`_adapters/payment/payload.js:27-30`).
- Anita/Naomie/Scroggins named in behavioral comments across FB endpoints and migrations.
- Help-chat KB tells every firm their processor is "Clover" (`_kb/knowledge-base.js:171`) — stale
  and wrong for everyone including SSL.

**Medium — SSL's operating model as template default (the real structural leak):**
- **Trust-first is hardcoded**: `invoices.account_type DEFAULT 'trust'` (1526), `|| 'trust'`
  fallbacks in `send-invoice.js:67` / `resend-invoice.js:45` / webhook, hardcoded `'trust'` in
  `mirror-fb-invoice.js:90`. Proposal: one firm-level `trust_first` flag (default on is fine —
  it's the conservative IOLTA-safe default) that drives all of these; kills redundancy 1-C too.
- **`help/guides/billing-trust.html` documents SSL's exact workflow as universal** — Frost Bank,
  the $100/mo fee, "for SSL", Anita's FB-first loop. Proposal: genericize the template copy;
  SSL keeps its tailored version in the SSL clone (help guides are per-deploy files already).
- **Family-law intake isn't module-gated**: `parenting_facilitation` case type (1208, explicitly
  Anita's PF practice), spouse trust-asset intake fields (1703), the whole Divorce-with-Children-
  derived intake schema (1222/1223) sit in base schema while immigration is cleanly premium-gated.
  Proposal (lower priority): treat family-law intake like immigration — a practice-area module.
- **Retainer-paid whole-team email is always-on** (`invoice-payment-webhook.js:111-131`) — an SSL
  workflow choice with no opt-out. Proposal: `firm_settings` toggle, default on for SSL.

**Model to follow:** `fb_auto_prepayment` (1535) — per-firm toggle, default off — and the payment
adapter layer are the cleanest examples already in the codebase. The rate resolver needs no change.

## 3. Migration consolidation (118 files → ~40-50, for NEW clients)

Numbers: 118 files, 10,954 lines. ~53 are "patch" migrations amending an earlier file in the same
family; ~55 files are under 30 lines (single column adds, single enum values, single INSERTs).
The USCIS 1600 family alone is 15 files / 3,892 lines (36% of all migration SQL).

**The binding constraint:** `db-migrate.ps1` tracks applied migrations **by exact filename**
(`applied-dev.txt` = sandbox, 118 entries; `applied-prod.txt` = 22 entries, stale at 1050; SSL
uses its own offset numbering; KCL has no ledger in this repo). Any rename/merge makes existing
deployments see "new" pending files. **Consolidation can only ever benefit new client spin-ups** —
existing DBs are already at current schema and must never replay.

**Two viable approaches:**

- **Option 1 — per-module squash (the 40-50 file outcome).** Merge patch chains into their base
  files: users column adds (1506/1512/1515/1521 → 1), invoice_line_items churn (1503+1531/32/33 →
  1; 1531 literally reverts a CHECK 1503 created), firm_settings (1513+1530/1535 → 1), trust suite
  (1200+5 patches → 1), scheduling (1010+3 → 1), practice areas (4 → 1), form-filler (5 → 1-2),
  G-28/I-765 sub-patches folded into base form files. Then hand-rewrite `applied-dev.txt` once.
  Pros: history stays readable per module. Cons: touching 60+ files, ledger rewrite per
  environment, doc references break, 3-4 hours of careful SQL merging + verification.

- **Option 2 — baseline snapshot (recommended).** Leave the 118 files untouched as history; add
  `supabase/baseline/000_baseline.sql` generated from the current sandbox schema (`pg_dump
  --schema-only` + the module/practice-area seed INSERTs + the 4 one-time backfills noted below
  become no-ops on fresh DBs). New-client procedure becomes: apply baseline, then only migrations
  numbered after the snapshot date. Existing deployments: zero change, zero risk. Regenerate the
  baseline at each future "checkpoint" (e.g. quarterly or per new-client onboarding).
  Pros: no renumbering, no ledger surgery, no broken doc references, new-client setup collapses
  from a 118-step (stale, hand-maintained-to-1518) runbook to one file + tail. Cons: two artifacts
  to keep honest (mitigate: a CI check that baseline + tail == migrations replayed on a scratch DB,
  or just regenerate baseline on demand).

**Hazards either way** (already mapped): 4 migrations contain one-time data backfills (1104, 1105,
1202, 1508) — safe as no-ops on fresh DBs but must not be lost; duplicate numbers 1106×2 and
1201×2 are load-bearing in sort order; `new-client-setup.md` Step 3's hand-list is stale at 1518
and its range table mislabels billing — it needs regeneration regardless of which option is chosen;
`new-module.ps1`/`merge-module.ps1` glob by module number range (keep ranges intact).

## 4. Repo hygiene (adjacent bloat, found along the way)

- **`pages/clients/detail/detail.js` is 6,899 lines** — 27% of all page code, 4.8× the next-largest
  file. Not urgent, but it's where every client-card feature lands; worth splitting by tab/section
  before it gets worse.
- **`uscis-forms/` is 96 MB in the repo** (204 files — form PDFs/templates). Candidates for R2 +
  a fetch script instead of git. `normalized/` (6.8 MB) + `clientdocs/` (3.8 MB) similar question.
- Root directory: 17 client sync scripts + 27 .md files (§2 covers the move).
- QuickBooks adapter is a throw-only stub — fine to keep as the seam marker, but it means
  `BILLING_PROVIDER` really has one value; don't build more on the abstraction until a second
  provider is real.

## 5. Proposed sequencing / decisions for Rob

1. **NOW: wire the two missing FB routes + resync SSL** (blocks the Naomie test). Add the
   route-coverage test.
2. **Decide: `billing_mode` enum** (portal | freshbooks_first) — collapses billing redundancies
   A/E and halves visible billing surface. My recommendation: yes.
3. **Decide: admin fee = expense category only**; demote/hide the recurring-charges cron UI.
4. **Decide: `trust_first` firm flag** replacing hardcoded trust defaults (default: on).
5. **Approve: move client one-offs out of root** (`deploy/ssl/`, `deploy/kcl/` or client repos) +
   comment/KB scrub (incl. the "Clover" line and the Payload merchant ID).
6. **Decide: migration approach** — recommendation is Option 2 (baseline snapshot), leaving the
   118 files as frozen history.
7. Genericize `help/guides/billing-trust.html` in the template; SSL keeps its tailored copy.
8. Backlog (not now): family-law intake as a module; split `detail.js`; `uscis-forms/` out of git.

Note: #3 partial trust release (Aug 5 deadline) is intentionally NOT in this list — but if built,
it should land inside whatever `billing_mode`/`trust_first` shape is decided here, not before.
