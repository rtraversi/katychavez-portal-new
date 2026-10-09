# Proof Scan contract fixtures

Batch 0 freezes data only. These fixtures are not imported by production code and do not change the current Proof Scan request, prompt, HTML, storage, history, or email path.

## Profile and result boundary

[`functions/api/proof-scan-profiles/daca-renewal.v1.json`](../../../functions/api/proof-scan-profiles/daca-renewal.v1.json) is the versioned `daca_renewal` profile. It deliberately maps to portal case type `daca` and contains 39 PDF rules only. The profile owns item and rule configuration; fixture `model_response` objects contain observations only. Non-PDF office/process checklist steps are deliberately outside this profile.

Each model response uses this shape:

```json
{
  "schema_version": 1,
  "scan_profile": "daca_renewal",
  "profile_version": 1,
  "scan": { "filename": "sample-daca-renewal.pdf", "scanned_at": "2026-09-02T00:00:00Z" },
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
    { "item_id": "DACA-COMP-G1450-FILING-FEE", "status": "clear", "locations": [], "evidence": null, "reason": null }
  ],
  "rule_results": [
    { "rule_id": "PS-101", "status": "clear", "summary": null, "locations": [], "evidence": null, "reason": null }
  ]
}
```

Allowed per-item statuses are `clear`, `needs_attention`, and `not_checked`. There is no overall `pass` field. Configuration-only fields such as severity, title, display order, expected condition, form, page, item, and applicability are resolved from the profile, never from Claude.

## Invariants for Batch 1

- Every `pdf_scan: true` rule ID in the selected profile must appear exactly once in `rule_results`.
- Every required `package_items.item_id` in the selected profile must appear exactly once in `package_items`.
- Unknown rule IDs and package-item IDs are invalid.
- Duplicate rule IDs and package-item IDs are invalid.
- Omitted expected IDs are invalid and never silently become `clear`.
- Claude supplies observations, locations, evidence, reasons, and evaluation status only.
- Full SSNs are forbidden. `client_observed.ssn_last4` is the only permitted SSN representation.
- A malformed or incomplete response must be rejected and cannot produce **No issues found**.
- A targeted `not_checked` rule must identify its `not_checked_item_ids`. When all of those items are missing, the validated result suppresses the rule by the stable blocking package-item ID; it does not add a second headline item. If a different targeted item is unreadable, that rule remains unsuppressed.

`expected` is a Batch 1 test oracle, not model data. The user-facing result language must be derived only after validation: `N items need attention`, `Review incomplete`, or `No issues found`; invalid input yields `Scan could not be completed`.

## Fixture convention

The three complete response fixtures contain literal model-response shapes. Other fixtures that specify `base_response_fixture` are deterministic mutation recipes: load that named fixture's `model_response`, then apply `mutation` or each entry in `mutations` before validation. This avoids duplicating a 39-rule response while retaining one explicit invalid condition per fixture. `malformed-model-output.json` instead supplies literal invalid JSON text.

All values are fictional placeholders; no fixture contains a real client record or a full SSN.
