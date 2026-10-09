# Proof Scan UI Lab — staged build plan

**Status:** ready for Batch 0. This is an implementation plan for Codex Terminal.

**Owner of product decisions:** Max. **First case type:** DACA renewal.

## The outcome

Create a second local tool beside the existing rule-testing lab:

`/Users/maxlugo/sites/proof-scan-lab/ui-lab/`

It is a **visually faithful, local-only copy of the Proof Scan experience**. It must use the
portal's real shared styles and page patterns. It will not call Anthropic, Supabase, R2, Resend, or
the live portal API. Its job is to let Max change and approve the results experience before the real
checker is changed.

The current `/Users/maxlugo/sites/proof-scan-lab/` remains unchanged. That lab runs PDFs against the
current prompt and records what the model actually says. It is the rule-testing bench. The new UI Lab
is the report-design bench.

---

## Decisions already made

1. Staff selects the **case type before a scan begins**. The selected type chooses the rules,
   required forms, and evidence checklist used for that scan.
2. DACA renewal is the first complete case type. Do not invent its requirements; Max/Katy supply
   them before the DACA fixture is called complete.
3. A result may only report a configured rule. The model must never create a rule, status, or
   severity on its own.
4. Findings are short: what failed, where it appears, and the configured rule. No AI explanation
   paragraphs.
5. **Needs attention** appears first. It contains actual blocking/fatal issues and configured
   warnings only.
6. Passed checks are collapsed by default and use one-line grouped summaries, such as
   `I-821D, I-765, and I-765WS are present. ✓`
7. **Not checked** is collapsed and normally absent. It appears only when a configured rule could
   not be evaluated because a page/document is missing, unreadable, or affected by OCR.
8. Each case type may have very different forms and evidence. The report layout remains stable:
   the case-specific content changes *inside* consistent sections.
9. The new UI must follow the portal's Docket kit (`css/variables.css`, `css/portal.css`, and
   `js/dk.js`). Do not create a new visual language or hard-code a parallel palette.

---

## Non-goals for the UI Lab

- Do not upload real client documents to it.
- Do not send email.
- Do not write to Supabase or read live firm data.
- Do not replace the existing Proof Scan page.
- Do not connect the existing `document_checklists` table yet. It is an upload/document checklist,
  and it does not currently model rule IDs, severity, evaluation status, accepted evidence
  alternatives, or citations. Reusing it without a deliberate schema decision would blur two
  different jobs.
- Do not silently add a DACA requirement based on general immigration knowledge.

---

## Target report structure

```
Proof Scan
Package: DACA renewal                         Case type: DACA renewal
Scanned: Aug 28, 2026                         1 item needs attention

Needs attention                               [shown only when non-empty]
  • I-765 edition date is outdated
    Page 7 · PS-101 Form edition

Required forms                                [always shown]
  ✓ I-821D, I-765, and I-765WS are present.
  ✓ Required signatures are present.

Supporting evidence                           [case-type specific]
  ✓ EAD card is present.
  ? One required item could not be read.      [only when real]

Passed checks (12)                            [collapsed]
Not checked (1)                               [collapsed; only if non-empty]
```

This is an information structure, not final copy. The DACA form/evidence labels above are examples
only until Max supplies the actual DACA checklist.

### Finding row rules

Every displayed finding must have:

| Field | Required UI behavior |
|---|---|
| `rule_id` | Visible in the expanded row; links the result to one configured rule. |
| `severity` | Comes from the rule configuration, never the model. Only configured `fatal` / `warning` values may be shown. |
| `title` | One direct sentence, e.g. `I-765 edition date is outdated.` |
| `location` | Page number(s), document name, or both. |
| `evidence` | Short observed fact/quote when the rule requires it. |
| `status` | Exactly `needs_attention`, `pass`, or `not_checked`. |

The model may return observed facts and citations. The application maps those facts to configured
rules and renders the severity/title from configuration. A model response without a valid `rule_id`
is rejected or placed in a future review queue; it is never shown as a staff alert.

---

## Fixture contract for the UI Lab

Use local JSON fixtures. Do not use AI-generated HTML as fixture data.

Suggested initial shape:

```json
{
  "schema_version": 1,
  "scan": { "filename": "daca-renewal.pdf", "scanned_at": "2026-08-28T00:00:00Z" },
  "case_type": { "key": "daca_renewal", "label": "DACA renewal" },
  "summary": { "fatal": 0, "warning": 1, "not_checked": 0 },
  "sections": [
    {
      "id": "required_forms",
      "label": "Required forms",
      "items": [
        {
          "rule_id": "DACA-FORM-001",
          "status": "pass",
          "severity": "fatal",
          "title": "Required DACA forms are present.",
          "summary": "I-821D, I-765, and I-765WS are present.",
          "locations": ["I-821D", "I-765", "I-765WS"]
        }
      ]
    }
  ]
}
```

The key point is the separation:

- **Rule configuration** owns rule ID, title template, section, severity, and applies-to case type.
- **Scan result** owns status, pages/documents, and observed evidence.
- **UI** only renders that structured result. It never parses model HTML and never guesses severity.

Fixture files to create in Batch 2:

| File | Purpose |
|---|---|
| `fixtures/approved-daca-edition-warning.json` | Known-good DACA package. Only the edition-date change may appear as an issue. |
| `fixtures/legacy-false-positive.json` | Shows the old invented signature-date and A-number-dash results, clearly as a rejected legacy example—not as valid future output. |
| `fixtures/error-injected-daca.json` | A placeholder for Max's deliberate-error test. Populate only from observed errors and the supplied checklist. |

Never put real client names, A-Numbers, PDFs, or document text into these fixtures.

---

## Batches for Codex Terminal

Complete one batch, show Max the result, and stop. Do not begin the next batch without an explicit
go-ahead. Run the batch's verification commands before reporting completion.

### Batch 0 — preflight and branch

**Goal:** establish a safe, repeatable starting point. No UI change.

1. In `/Users/maxlugo/sites/katychavez-portal-new`, run `git status --short` and preserve any
   unrelated user changes.
2. Create/switch to `module/proof-scan-ui-lab` from the approved starting branch. The repository
   rule is one branch per module.
3. Confirm the existing rule lab still runs from `/Users/maxlugo/sites/proof-scan-lab` and binds to
   localhost only.
4. Inspect the portal's actual app shell and stylesheet/script includes. Record the exact assets
   needed to render `pages/proof-scan/index.html` in the plan's implementation notes or in a small
   `ui-lab/README.md`. Do not guess the stylesheet list.

**Stop condition:** no application code changed; the branch and asset list are confirmed.

---

### Batch 1 — exact portal shell, local-only

**Goal:** make an empty UI Lab that looks like the real portal Proof Scan page before any proposed
results design is added.

**Files to add/change (expected):**

- `/Users/maxlugo/sites/proof-scan-lab/ui-lab/index.html`
- `/Users/maxlugo/sites/proof-scan-lab/ui-lab/ui-lab.js`
- `/Users/maxlugo/sites/proof-scan-lab/ui-lab/ui-lab.css` — only styles that are genuinely absent
  from the Docket kit; use portal tokens.
- `/Users/maxlugo/sites/proof-scan-lab/server.js` — add a safe localhost route for the UI Lab and
  a read-only, allow-listed route that serves the actual portal assets identified in Batch 0.
- `/Users/maxlugo/sites/proof-scan-lab/ui-lab/README.md`

**Requirements:**

1. The UI Lab must load the portal's current shared CSS/JS through the local server, rather than
   copying colors/fonts into a new stylesheet. It should therefore change when the real Docket kit
   changes.
2. Reproduce the real Proof Scan page shell: masthead, new-scan area, case-type selector,
   scan-rules area, result-region placement, and recent-scan area. Use real `.dk-*` classes.
3. The case-type selector is a UI-only control for now. It defaults to `DACA renewal` and makes no
   network request.
4. Replace file upload/run/email actions with clear local preview controls. They must not accept a
   PDF or call `/api/scan`; no user can mistake the Lab for a real scanner.
5. Add a small, quiet `Preview only — no scan is sent` label. It should not compete with findings.
6. Keep the existing `/` rule-testing lab route working exactly as it is.

**Acceptance test:** side-by-side with the portal's current Proof Scan page, the masthead, spacing,
type, tokens, buttons, section heads, and dark mode read as the same product. The page may have a
different local-only preview control, but must not look like a separate app.

**Verification:**

```bash
node --check /Users/maxlugo/sites/proof-scan-lab/server.js
node --check /Users/maxlugo/sites/proof-scan-lab/ui-lab/ui-lab.js
cd /Users/maxlugo/sites/katychavez-portal-new && npm test
```

Take one light-mode and one dark-mode screenshot of the local UI Lab. Show both to Max and stop.

---

### Batch 2 — structured report renderer and three fixtures

**Goal:** replace the empty result region with the proposed report behavior, using local JSON only.

**Files to add/change (expected):**

- `proof-scan-lab/ui-lab/fixtures/*.json`
- `proof-scan-lab/ui-lab/fixtures/index.js` or `fixtures.json`
- `proof-scan-lab/ui-lab/report-renderer.js`
- `proof-scan-lab/ui-lab/ui-lab.js`
- `proof-scan-lab/ui-lab/ui-lab.css` only as needed

**Requirements:**

1. Add a local fixture switcher. It must include the three fixtures in the fixture contract above.
2. Render **Needs attention** first and omit it when empty.
3. Render configured report sections in their configured order. Do not hard-code a universal set of
   DACA evidence requirements.
4. Show one-line, bundled pass rows. Pass details are collapsed by default.
5. Make **Not checked** absent when empty; when present, collapsed by default and specific about
   what prevented the check (for example, `Page 3 could not be read`).
6. Render fatal vs warning only from fixture configuration. The renderer must have no logic that
   infers a severity from words such as `FAIL`, `FATAL`, or `NEEDS CORRECTION`.
7. The legacy fixture must visually identify its invented findings as an old-output problem. It must
   not normalize them into future rule IDs or send any kind of alert.
8. Expand/collapse controls must be keyboard accessible and expose their state with
   `aria-expanded`.

**Acceptance test:** the approved DACA fixture is easy to read in under ten seconds. A reviewer sees
the one edition warning first, then a short passed-forms summary, with no paragraphs congratulating
the user for things the scan did not flag.

**Verification:** Batch 1 checks plus screenshots for all three fixtures in light and dark mode.
Show Max the three screens and stop.

---

### Batch 3 — editable DACA checklist preview

**Goal:** let Max feed exact DACA rules and immediately see how they read in the report. Still local
only; this is not a production rule editor.

**Files to add/change (expected):**

- `proof-scan-lab/ui-lab/checklists/daca-renewal.json`
- `proof-scan-lab/ui-lab/checklists/README.md`
- `proof-scan-lab/ui-lab/checklist-editor.js`
- `proof-scan-lab/ui-lab/ui-lab.js`

**Requirements:**

1. Give DACA its own checklist data file, separate from result fixtures.
2. Each checklist rule contains: stable ID, title, section, severity, required/optional state,
   applies-to form/evidence, expected evidence or accepted alternatives, and short pass wording.
3. Provide a local editor or editable data preview that updates the sample report without a server
   write. If a browser editor is used, add **Download checklist JSON**; never write files from the
   browser automatically.
4. Preserve Max's exact wording. Do not generate legal requirements, acceptable alternatives, or
   severity values.
5. The case-type selector shows DACA as available and marks all other choices `Not configured yet`.
   Selecting an unconfigured type must not display a fake checklist.

**Acceptance test:** Max can add/edit one DACA checklist row, see the exact resulting pass/fail/not-
checked presentation, and download the resulting local JSON for review.

**Verification:** validate all shipped JSON; run the Batch 1 checks; screenshot the edited DACA
state in light and dark. Show Max and stop.

---

### Batch 4 — DACA review and sign-off gate

**Goal:** turn the UI Lab into a decision point, not an endless mockup.

1. Max supplies or approves the authoritative DACA renewal requirements: required forms, required
   evidence, optional evidence, accepted alternatives, and severity of each miss.
2. Enter those exact items in `checklists/daca-renewal.json`.
3. Use the approved DACA and error-injected DACA facts to create expected report fixtures. Do not
   copy any real client-identifying data.
4. Review with Max:
   - Are all fatal issues at the top?
   - Are pass summaries short enough?
   - Does every not-checked item justify human action?
   - Does the report make clear what the scanner did and did not check?
   - Is the wording suitable for staff and attorney review?
5. Record decisions and unresolved rule questions in `proof-scan-lab/NOTES.md`, with a new dated
   block. Do not claim a DACA rule is final until Max says it is.

**Stop condition:** Max explicitly signs off on the DACA report shape and data contract. Only then
begin production-backend planning.

---

### Batch 5 — production implementation plan (write only after Batch 4 sign-off)

**Goal:** plan the real checker change. This batch is a plan, not permission to deploy.

The plan must cover all of the following:

1. **Case type selection:** add a required case-type selector to `pages/proof-scan/index.html` and
   send its key with the scan request. Do not infer case type from forms.
2. **Database:** add new migrations for a purpose-built rule/checklist model, such as
   `proof_scan_rule_sets`, `proof_scan_rules`, and `proof_scan_evidence_requirements`, or an
   equally explicit alternative. Define how firm-specific overrides work. Do not overload
   `document_checklists` without a signed-off migration design.
3. **Structured response:** replace model-generated HTML with validated JSON whose finding
   `rule_id` is one of the active rules for the selected case type. The server renders/stores the
   results from data.
4. **Closed-world enforcement:** reject or quarantine a model item with an unknown rule ID. It must
   not affect the stored status or notification email.
5. **Deterministic checks:** decide which facts the model extracts and which checks code verifies
   (especially routing number checksum and cross-form comparisons).
6. **Email:** only notify for configured severities. The message must name the real rule(s) that
   need attention, not issue a generic alarm from arbitrary model HTML.
7. **History and compatibility:** migrate or clearly label legacy `result_html` scans. Do not break
   existing scan history.
8. **Tests:** add fixtures for clean DACA, old-edition DACA, deliberate DACA errors, and previous
   false positives. Test unknown rule rejection, no email for a rejected finding, section ordering,
   and OCR/not-checked rendering.
9. **Platform limits:** measure a real, redacted large package before implementing evidence scans;
   retain a clear file-size failure message even if the measurement passes.

The production work should then be split into new, separately approved batches. It must run
`npm test`, include light/dark UI verification, and stay on its own module branch.

---

## Questions that intentionally remain open

These are product decisions, not gaps Codex should fill with guesses:

1. The complete DACA renewal checklist, including the missing evidence item Max could not recall.
2. Which DACA misses are fatal versus warning.
3. Whether G-1650 validation remains a firm rule.
4. Who may edit live rules and who approves them.
5. Whether unexpected model observations belong in an internal review queue, or should be discarded
   entirely in version 1.
6. The case types and order after DACA.

---

## Source files and context

- Portal page: `pages/proof-scan/index.html`
- Current client renderer: `pages/proof-scan/proof-scan.js`
- Current API/prompt: `functions/api/proof-scan.js`
- Portal design system: `DESIGN-SYSTEM.md`, `css/variables.css`, `css/portal.css`, `js/dk.js`
- Rule-testing lab: `/Users/maxlugo/sites/proof-scan-lab/`
- Notes and observed defects: `/Users/maxlugo/sites/proof-scan-lab/NOTES.md`
- Rule catalog: `PROOF-SCAN-RULES.md`
- Architecture handoff: `PROOF-SCAN-HANDOFF.md`

The current portal page has a Docket-style shell, but the report area still injects model-generated
HTML (`themeResultHtml`). That is why the UI Lab renders local structured JSON: the production
change must eventually remove that boundary rather than merely cosmetically restyle it.

---

## Batch 0 implementation notes — 2026-08-31

### Confirmed portal source and asset allow-list

The Proof Scan page is a dynamically loaded fragment, not a standalone document:

- Shell source: `portal.html`.
- Dynamic loader: `js/menu.js` fetches `pages/proof-scan/index.html`, then appends
  `pages/proof-scan/proof-scan.js`.
- Page fragment: `pages/proof-scan/index.html`.
- Current production page controller: `pages/proof-scan/proof-scan.js`.

The future UI Lab must serve the following current portal assets read-only through its local server;
do not copy their palette or recreate the Docket kit:

- `css/variables.css`
- `css/portal.css`
- `js/theme.js` (before the body, to apply `data-theme` and `data-mode`)
- `js/dk.js` (Docket render helpers)

For exact type parity, the portal shell currently loads this font stylesheet:

`https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600&family=Sora:wght@400;600&family=Codystar:wght@300;400&family=Lora:ital,wght@0,400;0,600;1,400;1,600&display=swap`

The UI Lab must not load or execute `js/config.js`, `js/supabase-client.js`, `js/auth.js`,
`modules/registry.js`, `js/menu.js`, `js/portal-init.js`, or
`pages/proof-scan/proof-scan.js`: those files are portal/auth/runtime behavior and can reach live
services. `portal.html` and `pages/proof-scan/index.html` are markup references; Batch 1 will use
only the local-safe shell subset and replace all scan, upload, email, rules, history, and API behavior
with explicitly local preview controls.

### Batch 0 preflight result

- Branch created from the approved `module/forms-page-reorg` starting branch:
  `module/proof-scan-ui-lab`.
- The existing rule-testing lab was started without an API key, returned HTTP 200 at `/`, and listened
  only on `127.0.0.1:5174`; the temporary verification process was stopped afterward.
- No UI or application code was changed. The `ui-lab/` directory did not exist at preflight.
