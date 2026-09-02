# Proof Scan — Production Build Packet

**Prepared:** 2026-09-02  
**Status:** implementation plan only; not permission to deploy  
**First scan profile:** DACA renewal  
**Product owner:** Max

## Objective

Move the approved Proof Scan UI Lab experience into the real portal while replacing the current
model-authored HTML pipeline with a closed, structured result pipeline.

Claude observes the uploaded package. Approved profile data defines what may be checked. Portal
code validates the response, calculates the report state, and renders the report.

## Approved product decisions

1. Staff explicitly selects a scan profile before choosing a PDF. The package does not determine
   its own profile from its filename, forms, or model inference.
2. `daca_renewal` is the first production profile. It maps deliberately to the portal's broader
   `daca` case type.
3. Adjustment of status is a later profile and a separate project phase. Its rules, required forms,
   and evidence may be substantially more complex, but it will reuse the stable report shell.
4. The report's client summary shows values observed in the uploaded package. It is not silently
   populated from or overwritten by the portal client record.
5. Connecting a scan to an existing client or matter is a possible later feature. It must not block
   the first production integration.
6. There is no user-facing overall `PASS`, `approved`, `correct`, or `ready to file` verdict.
7. A clean completed scan says **No issues found**. This means no configured issue was found in the
   readable material; it is not a guarantee that the filing is correct.
8. Every report retains a quiet, persistent statement that staff review is required before filing.
9. Anything failed, missing, unreadable, or unevaluated requires attention. A scan with any
   unevaluated required check cannot say **No issues found**.
10. Claude must return a status for every expected rule. An omitted rule is never an automatic clear.
11. Required package items use stable IDs. Missing forms/evidence are never matched by free-text names.
12. The UI Lab's red diagnostic sections, including **Not in the checklist** and **What the current
    checker said**, are test-harness material only. They must not appear in the staff-facing build.

## User-facing report states

The application derives display language from validated item states; Claude does not provide a
report verdict.

| Condition | Primary report language | Required behavior |
|---|---|---|
| One or more failed or missing configured items | `N items need attention` | Put those items first |
| No failures, but one or more checks could not be completed | `Review incomplete` | Name every item not checked |
| Every expected item was evaluated and no configured issue was found | `No issues found` | Still show the staff-review reminder |
| Model response is incomplete, malformed, or cannot be validated | `Scan could not be completed` | Do not store or display a clean result |

Do not use success language based only on the model's prose. Trust should come from observed accuracy
over time, not from a confident label.

## Current production flow being replaced

1. The browser reads the entire PDF as base64.
2. It posts `{ file_base64, filename }` to `/api/proof-scan`.
3. The Worker appends form editions and free-text firm instructions to one general prompt.
4. Claude infers the case type, chooses findings and severity, and writes final HTML.
5. The Worker searches that HTML for `NEEDS CORRECTION` to derive database status.
6. Raw model HTML is stored, injected into the page, reopened from history, and embedded in email.

The first production release replaces steps 3–6. Transport changes for very large PDFs are a later
hardening decision after measurement, except for a clear file-size guard in this build.

## Target production flow

```text
Explicit scan profile + PDF
            |
            v
POST /api/proof-scan
            |
            v
Server loads the exact versioned profile and allowed IDs
            |
            v
Claude returns schema-constrained observations for those IDs
            |
            v
Server validates complete rule/package-item coverage
            |
            v
Server derives report state and stores versioned result JSON
            |
            v
Approved renderer draws the portal report
            |
            +------------------+
            |                  |
         History             Email
```

## Ownership boundaries

### Scan profile owns

- Profile ID, label, version, and portal case-type mapping
- Required package-item IDs and presentation order
- Allowed rule IDs and their order
- Rule title, expected condition, severity, and applicability
- Which rules are required and what `not_checked` means for the report state

### Claude owns

- Observed facts from the PDF
- Per-rule evaluation: `clear`, `needs_attention`, or `not_checked`
- Page/document locations
- Short evidence text
- Observed client-summary fields

Claude does not own rule IDs, severity, display order, report state, email policy, or HTML.

### Portal code owns

- Request and response validation
- Exact expected-ID coverage
- Rejection of unknown and duplicate IDs
- Deterministic comparisons and calculations
- Report-state calculation
- Storage, rendering, history, and notification formatting

## Minimum structured result contract

The precise schema may evolve during Batch 1, but it must preserve these boundaries:

```json
{
  "schema_version": 1,
  "scan_profile": "daca_renewal",
  "profile_version": 1,
  "scan": {
    "filename": "package.pdf",
    "scanned_at": "2026-09-02T00:00:00Z"
  },
  "client_observed": {
    "name": null,
    "a_number": null,
    "ead_expires": null,
    "date_of_birth": null,
    "ssn_last4": null,
    "uscis_account_number": null,
    "phone": null,
    "email": null,
    "address": null
  },
  "package_items": [
    {
      "item_id": "DACA-COMP-G1450-BIOMETRICS",
      "status": "clear",
      "locations": []
    }
  ],
  "rule_results": [
    {
      "rule_id": "DACA-G28-001",
      "status": "clear",
      "summary": null,
      "locations": [],
      "evidence": null,
      "reason": null
    }
  ]
}
```

Full SSNs are forbidden. Only four digits may be accepted in `ssn_last4`. Unknown properties should
be rejected at the server boundary.

## Production file map

Expected application areas; Terminal must confirm before editing:

- `pages/proof-scan/index.html` — scan-profile selection, upload shell, result mount, history
- `pages/proof-scan/proof-scan.js` — real interactions, API call, renderer entry point
- `pages/proof-scan/report.js` — production-safe renderer derived from the lab renderer
- `css/portal.css` — approved `.psr-*` report and interaction styles only
- `functions/api/proof-scan.js` — structured model request and server validation
- `functions/api/proof-scan-history.js` — structured history metadata/detail path
- `functions/api/_notifications.js` — deterministic escaped email renderer
- `functions/api/_schemas.js` — bounded request validation
- `supabase/migrations/` — additive structured-result storage
- `_worker.js` — only if a separate authenticated detail endpoint is added
- `test/` — contract, API, history, rendering, and compatibility tests

The lab's fixture controls, fake scan timer, theme shell, and `.ps-lab-*` rules never move into these
files.

## Terminal implementation batches

Each batch is a separate Terminal assignment. Terminal runs verification, reports changed files,
and stops. Desktop reviews before issuing the next assignment.

### Batch 0 — baseline and contract freeze

- Confirm the target branch/worktree and preserve unrelated changes.
- Record baseline `npm test` results.
- Copy no application code.
- Finalize the versioned DACA profile shape and stable composition-item IDs.
- Add representative sanitized contract fixtures for clean, attention, incomplete, malformed,
  unknown-ID, duplicate-ID, and omitted-ID responses.

**Gate:** Desktop reviews the contract and display-state language. No production behavior changes.

### Batch 1 — validation and report composition

- Implement pure server-side validation/composition code.
- Require exact coverage of every applicable rule and package-item ID.
- Reject unknown and duplicate IDs.
- Convert omitted expected IDs to a failed scan response, not `clear`.
- Derive `items need attention`, `review incomplete`, or `no issues found` in code.
- Add unit tests before connecting Anthropic or the UI.

**Gate:** all contract fixtures produce the expected deterministic report state.

### Batch 2 — structured DACA API and additive storage

- Add bounded request validation including explicit `scan_profile` and PDF size/type checks.
- Load `daca_renewal` server-side; do not trust client-supplied rules.
- Replace model HTML output with schema-constrained JSON observations.
- Validate model stop/completion state and the returned schema.
- Add nullable `result_json`, schema/profile version, and report-state fields to `proof_scans`.
- Preserve `result_html` for legacy rows; do not rewrite old scans.
- Do not send email from unvalidated output.

**Gate:** API tests prove malformed, unknown, duplicate, and omitted IDs cannot yield a clean report.

### Batch 3 — approved portal experience

- Add a required `Choose scan type` control. Only configured profiles are selectable.
- Keep upload unavailable until a profile is explicitly selected.
- Port the approved file-arrival, scan-button, result-reveal, summary, disclosure, and responsive
  behavior from the lab.
- Dynamically import the production renderer from the existing page controller; do not change the
  global portal page loader.
- Render only validated structured data with DOM text nodes.
- Exclude every lab diagnostic/refusal section and all legacy commentary.
- Show observed client-summary values only when present.
- Use the approved report-state language and permanent staff-review reminder.

**Gate:** Desktop reviews real screenshots in light/dark and desktop/mobile widths.

### Batch 4 — history, email, and legacy compatibility

- Add an authenticated structured scan-detail path instead of direct frontend Supabase access.
- Render new history entries from `result_json`.
- Open old `result_html` rows in a clearly labeled legacy view.
- Generate email deterministically from validated result data with escaped values.
- Use the same no-verdict language in the UI, history, subject line, and email.
- Confirm unknown or unvalidated observations can never trigger notification.

**Gate:** new and legacy scans both open correctly; email contains no model-authored HTML.

### Batch 5 — production hardening and DACA evidence run

