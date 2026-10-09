# Proof Scan UI Lab — Session Log

**Date:** 2026-08-31  
**Branch:** `module/proof-scan-ui-lab`  
**Scope:** Batch 0 and Batch 1 only. Batch 2 has not started.

## Purpose

Create a second, local-only UI Lab at `/Users/maxlugo/sites/proof-scan-lab/ui-lab/` for reviewing
the Proof Scan experience before production work begins. It must use the portal's actual Docket
presentation assets without calling Anthropic, Supabase, R2, Resend, a database, or a live portal API.

## Product decisions recorded today

- A staff member must select the case type **before** the real scan runs. That selection determines
  the allowed rules, required forms, and evidence checklist.
- DACA renewal is the first case type to define. Do not infer or invent its requirements; Max/Katy
  will supply and approve them.
- The existing checker currently has only generic prompt rules. It does not read the existing
  case-type document checklists, so it misses case-specific errors.
- The eventual report must show configured fatal/warning issues first. Every finding needs a stable
  rule ID; the model cannot invent a rule or severity.
- Passed checks should be collapsed by default and summarized in short bundled lines. Suppressions
  and clean checks must not create AI explanation paragraphs.
- `Not checked` is collapsed and appears only for a real inability to evaluate a configured item,
  such as unreadable/OCR-limited material.
- The new UI Lab must duplicate the portal's actual presentation system, not become a separate
  design mockup.

Full rationale and batch definitions are in `PROOF-SCAN-UI-LAB-PLAN.md`. Observed DACA scan issues
and notes N-010 through N-020 are in `/Users/maxlugo/sites/proof-scan-lab/NOTES.md`.

## Batch 0 — completed

- Read the required project, design-system, plan, handoff, rule-catalog, and lab-notes files.
- Created `module/proof-scan-ui-lab` from `module/forms-page-reorg` at commit `47eb290`.
- Confirmed the existing rule-testing lab starts on `127.0.0.1:5174` and its `/` route returns HTTP 200.
- Recorded the portal asset allow-list in `PROOF-SCAN-UI-LAB-PLAN.md`:
  - `css/variables.css`
  - `css/portal.css`
  - `js/theme.js`
  - `js/dk.js`
- Confirmed reference shell files:
  - `portal.html`
  - `pages/proof-scan/index.html`
  - `js/menu.js`

## Batch 1 — completed

### Files added or changed

- `/Users/maxlugo/sites/proof-scan-lab/server.js`
  - Added a localhost-only UI Lab route at `/ui-lab/`.
  - Added an explicit read-only allow-list for the four portal presentation assets above.
  - Does not proxy arbitrary portal files.
- `/Users/maxlugo/sites/proof-scan-lab/ui-lab/index.html`
  - Recreates the portal shell and Proof Scan placement: masthead, New Scan, case-type selector,
    Scan Rules, Scan Results, and Recent Scans.
  - Shows `Preview only — no scan is sent.`
  - Defaults case type to DACA renewal.
  - Has no file input and no working scan button.
- `/Users/maxlugo/sites/proof-scan-lab/ui-lab/ui-lab.js`
  - Local-only Rules disclosure and light/dark mode control; no fetch, upload, storage, or API calls.
- `/Users/maxlugo/sites/proof-scan-lab/ui-lab/ui-lab.css`
  - Minimal Lab-only styles; visual tokens, typography, layout, and dark mode come from portal assets.
- `/Users/maxlugo/sites/proof-scan-lab/ui-lab/README.md`
  - Documents startup and the local-only safety boundary.

### External visual dependency

The UI Lab uses the portal's existing Google Fonts stylesheet for type fidelity. This is the only
external dependency. It does not call a portal service, Anthropic, Supabase, R2, Resend, or a database.

### Explicit exclusions

The UI Lab does not load or execute:

- `js/config.js`
- `js/supabase-client.js`
- `js/auth.js`
- `modules/registry.js`
- `js/menu.js`
- `js/portal-init.js`
- `pages/proof-scan/proof-scan.js`

## Verification

- `node --check /Users/maxlugo/sites/proof-scan-lab/server.js` — passed.
- `node --check /Users/maxlugo/sites/proof-scan-lab/ui-lab/ui-lab.js` — passed.
- Existing lab `/` — HTTP 200.
- UI Lab `/ui-lab/` — HTTP 200.
- Allow-listed portal assets — HTTP 200.
- Unsafe `/ui-lab/portal-assets/js/config.js` — HTTP 404.
- The temporary verification server was confirmed bound to `127.0.0.1:5174` and was stopped.
- `npm test` did not run: the checkout has no `vitest` executable (`sh: vitest: command not found`).
- Light/dark screenshots were not captured because no browser surface was available in this session.

## Current status and next gate

- Current branch: `module/proof-scan-ui-lab`.
- No production Proof Scan page, API, database migration, deploy, or push was changed.
- Batch 2 must not begin until explicitly approved.
- Before a Batch 1 sign-off, restore the local test dependency and capture light/dark screenshots of
  `http://localhost:5174/ui-lab/`.

## Start here next session

1. Start the Lab locally:

   ```bash
   cd /Users/maxlugo/sites/proof-scan-lab
   node server.js
   ```

2. Open `http://localhost:5174/ui-lab/` and have Max review the literal portal shell.
3. Fix only visual-shell issues that Max identifies. Do not add report fixtures yet.
4. Once the shell is approved, run **Batch 2 only** from `PROOF-SCAN-UI-LAB-PLAN.md`: local JSON
   fixtures and the structured report renderer. Stop for review when it is complete.
