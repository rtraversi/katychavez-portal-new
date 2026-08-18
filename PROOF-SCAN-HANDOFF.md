# Proof Scan — Rules Revamp Handoff

**For:** Max
**Written:** 2026-08-18

> **This is a guideline, not a spec.** It's a starting map of what's there now and what looked worth attention from a read of the code — nothing here is a requirement. Max owns the approach and can change, reorder, or discard any of it. Where it makes a recommendation, treat that as one opinion to weigh, not a decision already made.

## The ask

Three deliverables, in Rob's words:

1. **Evaluate all of the rules and make sure that each aspect of the proof checklist is being handled.** This is a *coverage* exercise: every item on the firm's proof checklist must map to an implemented rule, and every gap becomes a new rule. → §3, §4
2. **Adjust the proof scan so it only finds what is on the list — it doesn't add in any checks of its own.** The reported symptom is a lot of false positives caused by the AI inventing its own rules or deciding on its own what to look at. → §2
3. **Add in evidence-based testing based on case type.** Today the scan looks at forms only; it needs to analyze the supporting evidence against what that case type requires and report what's missing. → §5

One cross-cutting constraint that came up alongside these: this was built as a **Netlify** function and now runs on **Cloudflare**, where document size limits and timeouts are different. It was never re-tuned. Specifically, **on Netlify an AOS package with many pages of evidence could not complete inside the 26 s function timeout** — which is exactly the case item 3 depends on. Cloudflare's limits are shaped differently and the old wall may simply not exist; **Rob's call is that Max determines whether this needs handling**, by measuring rather than assuming. → §6

> **Worth getting up front for item 1.** "The proof checklist" is most useful as an actual artifact from Rob or the paralegals. The nine checks currently in the prompt (§3) are what the *code* does; they are not evidence of what the *firm's checklist* says. Without the authoritative list, "is each aspect handled?" is hard to answer, and guessing at it risks recreating the problem in item 2.

---

## 1. What the checker actually is

One Anthropic API call. A staff user uploads a PDF (an assembled USCIS filing package); the Worker sends that PDF plus a large system prompt to Claude and stores the returned HTML report. There is no per-rule code, no parser, no deterministic validation — **every rule is a sentence in a prompt string.**

Understand that before changing anything: "the rules" are prose, and the model is the entire enforcement engine. That is also the root cause of the false positives in item 2 — see §2.

### File map

| Path | What it holds |
|---|---|
| `functions/api/proof-scan.js:9-72` | `SYSTEM_PROMPT_BASE` — **all 9 checks, the role/PIP preamble, the bank routing table, the NOTES exception list, and the output format spec** |
| `functions/api/proof-scan.js:7` | `FALLBACK_EDITIONS` — hardcoded edition string used if the DB read fails |
| `functions/api/proof-scan.js:86-99` | Injects `{{FORM_EDITIONS}}` from the `form_editions` table |
| `functions/api/proof-scan.js:101-110` | Appends per-firm `custom_instructions` from `proof_scan_config` |
| `functions/api/proof-scan.js:113-160` | The Anthropic call (model, max_tokens, PDF document block) |
| `functions/api/proof-scan.js:162-165` | Status derivation + token accounting |
| `functions/api/proof-scan-config.js` | GET/POST the firm's `custom_instructions` + `notify_email` (singleton row) |
| `functions/api/proof-scan-history.js` | Last 10 scans (metadata only) |
| `pages/proof-scan/proof-scan.js` | Upload UI, result rendering, history, config modal |
| `pages/proof-scan/proof-scan.js:112-128` | Reads the whole file to base64 in the browser, posts it as JSON |
| `pages/proof-scan/proof-scan.js:329-355` | Post-processes the model's HTML — retags status cells by regex on `PASS` / `NEEDS CORRECTION` / `FAIL` |
| `supabase/migrations/1300_proof_scan.sql` | `form_editions`, `proof_scan_config`, `proof_scans`; module registration |
| `supabase/migrations/1704_form_edition_guard.sql` | Adds `check_status`, `last_verified_at`, `upstream_edition`, `source_url` to `form_editions` |
| `functions/api/process-form-edition-check.js` | Weekly cron that checks uscis.gov and sets `check_status` |
| `_worker.js:223-225` | Route registration |
| `modules/registry.js:293-306` | Module tile (`proof_scan`, staffOnly, `requires: 'immigration'`) |

### How the prompt is assembled per request

```
SYSTEM_PROMPT_BASE
  └─ {{FORM_EDITIONS}}  ← SELECT form_number, pages, edition_date FROM form_editions
                           (falls back silently to the hardcoded 2026-06 string)
  + "ADDITIONAL FIRM-SPECIFIC INSTRUCTIONS…"
  └─ proof_scan_config.custom_instructions  ← per-firm, edited from the UI
```

Everything else — the routing table, every exception, the output format — is frozen in the source string.

---

## 2. Item 2: the scan is open-world, and that is why it invents rules

This is the highest-priority item and it is a **design** problem, not a wording problem.

### Why it happens

- The prompt says *"check for the issues listed below"* (`proof-scan.js:9`) — but **nothing anywhere forbids reporting anything else.** An instruction to check nine things is not an instruction to check *only* nine things.
- The output contract asks for a free-form table: `Status | Form/Document | Issue | Detail` (`proof-scan.js:69`). A blank "Issue" column is an open invitation to write down anything that looks off. **The schema itself permits invented findings.**
- The entire NOTES block (`proof-scan.js:63-68`) is negative — seven variations of *"do not flag X."* That is the fingerprint of an open-world prompt being fought one false positive at a time. **It will never converge:** each new note only suppresses the specific hallucination that already happened, and the list grows forever while new invented rules keep appearing.
- Nothing tells the model what is **out of scope** (legal sufficiency, eligibility, filing strategy, "this looks unusual"), so it fills the gap with its own judgment.

### How to actually close the world

Ordered strongest to weakest. The first one is a structural fix; the rest are supporting.

1. **Give every rule an ID and make the output a structured schema whose `rule_id` is a closed enum.** Use `output_config: {format: {...}}` on the API call and have the model return JSON, not HTML — every finding must carry a `rule_id` drawn from the enum. A finding that maps to no defined rule becomes **impossible to express**, rather than merely discouraged. Render the HTML report from that JSON on our side. This converts the closed-world requirement from an instruction the model may drift from into a constraint it cannot violate.
2. **Store the rules as data, not prose.** A `proof_scan_rules` table (id, short name, the check text, applies-to forms, severity, active flag) lets rules be added, edited, retired, and A/B'd without a code deploy — which is what item 1 needs in order to close checklist gaps without shipping code each time — and lets the enum in (1) be generated from the active rows. It also makes per-rule false-positive rates measurable.
3. **State the closed world explicitly and state what is out of scope.** e.g. *"Report ONLY findings that correspond to one of the numbered rules below. If something appears unusual but does not match a rule, do not report it. Do not assess legal sufficiency, eligibility, or filing strategy."*
4. **Require evidence for every finding** — page number plus the quoted text the model relied on. Invented findings usually cannot cite, and an uncitable finding can be filtered automatically.
5. **Add a confidence or severity field** so borderline calls surface as advisory instead of as errors, rather than being either shouted or silently dropped.

Once (1) and (2) exist, most of the NOTES block can be deleted — its content either becomes a scope condition on a specific rule or stops being necessary at all.

---

## 3. The current rule inventory (what you're evaluating)

**Preamble (role disambiguation)** — beneficiary vs. petitioner/sponsor, plus a dedicated Military Parole in Place (PIP) block. Exists to stop the model flagging a service member's documents as a name mismatch.

**The nine checks:**

| # | Rule | Nature |
|---|---|---|
| 1 | Form edition date in the footer of **every page**, vs. current USCIS edition; also intra-form consistency (old signature page mixed into a current package) | Objective, needs the editions table |
| 2 | Page counts per form | Objective, needs the editions table |
| 3 | Blank or duplicate pages (G-1450/G-1650 dupes exempted) | Objective |
| 4 | Required signatures — applicant + attorney/preparer (I-765WS exempt) | Objective |
| 5 | Signature dates — attorney must not sign before applicant | Objective |
| 6 | Name consistency (beneficiary across forms; petitioner docs exempt) | **Judgment** |
| 7 | A-Number consistency, format-normalized | Objective |
| 8 | Mailing address consistency | Mostly objective |
| 9 | G-1650 bank routing number validation against a 40-entry inline bank list | Objective, currently done by the model |

**NOTES (the accretion layer)** — seven exceptions bolted on over time: G-1450/G-1650 need no signature date; multiple payment forms are normal; I-765WS never on the G-28 for DACA; I-765WS unsigned is fine; I-821D items 6-8 don't apply (renewals only); supporting docs in another name may belong to the petitioner.

**Output contract** — summary with PASS / NEEDS CORRECTION, an HTML table, a cross-check section, and a Bank Validation section when a G-1650 is present.

**Redundancy to clean up:** the I-765WS signature exemption appears twice; the G-1450/G-1650 duplicate rule appears three times. Repetition is not free — it competes for attention with the checks that matter.

---

## 4. Item 1: checklist coverage

The deliverable here is a **coverage matrix**, not a pile of new prompt text: one row per item on the firm's proof checklist, mapped to the rule that implements it, with the fixture that proves it fires. Three outcomes per row — *implemented and verified*, *implemented but wrong/unverified*, or *missing*. The missing rows are the new rules; the wrong rows are the edits. Hand that matrix back with the work, because it is the only artifact that answers "is each aspect being handled?"

Pruning is in scope too: any rule in §3 that maps to **no** checklist item is either an undocumented requirement worth writing down, or scope the scan shouldn't have — and unmapped rules are a prime false-positive source under item 2.

Candidates likely to show up as gaps, pending the real checklist — Rob and the paralegals should confirm which are real:

- **Fee/payment coverage** — one payment form (G-1450 or G-1650) per filing fee actually due for the forms present. Today multiple payment forms are merely tolerated; nothing checks that the *count matches the filings*.
- **G-28 coverage** — an attorney of record form for each applicant/petitioner on the package, and the right party named on each.
- **Form-set completeness by case type** — e.g. an I-485 without the required I-693 or I-864 where applicable; an I-130 without the I-130A when the beneficiary is a spouse. This is the form-level sibling of the evidence checklist in §5.
- **Signature freshness** — signatures dated implausibly long before the filing date.
- **Legibility / scan quality** — cut-off pages, rotated pages, pages scanned at an unreadable resolution. Common real-world rejection cause and currently unchecked.
- **Page order / assembly** — pages of one form interleaved into another.
- **Checkbox/field completeness** on high-risk items, scoped narrowly per form (this one is a false-positive magnet — define it tightly or not at all).
- **Barcode / form-type confirmation** — verify the form each page claims to be actually matches the form it was filed under.

Each new rule needs: an ID, the exact condition, which forms it applies to, and at least one fixture that must trip it and one that must not.

---

## 5. Item 3: evidence checks by case type

Adding "analyze the evidence and determine if anything is missing" is a genuinely different class of rule from everything above, and it is **the single easiest way to reintroduce the false-positive problem** — because "what's missing" is an open-ended question by nature. If it is implemented as a free-form ask, the model will invent requirements the firm never asked for, which is exactly the complaint in §2.

**Build it from an explicit checklist, not from the model's own knowledge of immigration practice.**

Suggested shape:
- A table (e.g. `proof_scan_evidence_requirements`) keyed by **case type** (and/or the primary form) listing each expected evidence item: name, required vs. recommended, accepted alternatives, and notes. Firm-editable, same way `custom_instructions` is.
- The scan's evidence pass then becomes a **closed** question: for each row in the checklist for this case type, is a document satisfying it present in the package — yes, no, or unclear? The model classifies the documents it can see against a fixed list; it never proposes new requirements.
- Report evidence findings as their own section with the same `rule_id`/evidence-item-ID discipline as §2.

Design questions Max needs answered by Rob before building:
- **How is case type determined** — inferred from the forms present, or selected by the user at upload? Inferring it is another place the model can be wrong, and a wrong case type produces a wholly wrong checklist.
- **Is "unclear" a failure?** A blurry utility bill that might be a joint-residence document should probably not be reported the same way as an absent one.
- **Who maintains the checklists** — shipped defaults in the template plus per-firm overrides, or firm-authored from scratch?
- **Does evidence review need the same doc in a different scan pass?** See §6 — evidence packages are far larger than form packages, and that has hard platform implications.

---

## 6. Cross-cutting: Netlify → Cloudflare platform reality

The code is described in its own header comment as a *"CF Worker port from Katy's Netlify function"* (`proof-scan.js:1`), and the porting stopped at making it run. The limits are different and nothing was re-tuned. This matters a lot more once evidence packages (§5) are in scope — those are much bigger PDFs than form packages.

### The known history: the Netlify 26 s timeout

**On Netlify, an AOS package with many pages of evidence could not complete — the 26 s function timeout killed it.** That is the origin of Rob's concern, and it is the single most likely thing to sink item 3, since an AOS evidence package is exactly the worst case.

The good news is that **the Netlify wall does not transfer directly.** Cloudflare Workers limit **CPU time**, not wall-clock time, and time spent awaiting a `fetch()` subrequest does not count against the CPU budget. Waiting several minutes on a slow Anthropic response is not itself the thing that kills a Worker — this project already runs on Workers Paid with `cpu_ms = 60000`, and the CPU actually spent here is base64/JSON handling, not the model call.

So the question is not "do we have 26 seconds?" — it's which of these actually binds first for a real AOS package:

- **CPU time** during base64 decode / JSON parse of a very large body (the one thing that *is* capped at 60 s).
- **Isolate memory** — 128 MB, with multiple copies of a large base64 string live at once.
- **Request body size** — plan-dependent on Cloudflare; a 413 happens before the Worker ever runs.
- **Anthropic-side limits** — 32 MB request, 600 pages. An AOS evidence package can plausibly exceed both.
- **How long the connection is held open** end-to-end before the browser or the edge gives up. Verify the current behaviour rather than assuming; this is the one most likely to *look* like the old Netlify timeout.

**Rob's call: Max defines whether this needs handling.** The way to settle it is a measurement, not a judgment — take the largest real AOS package on hand, run it end to end, and record which ceiling is hit first (and the CPU time, body size, page count, and wall-clock actually observed). If nothing breaks, document the headroom and move on. If something breaks, the mitigations in the next section are ordered roughly by cost.

**What the current path does:** the browser reads the entire file into a base64 string (`pages/proof-scan/proof-scan.js:113-120`), posts it as a JSON body, the Worker parses that JSON into memory, and forwards the base64 to Anthropic. Base64 inflates the payload by ~33%, and at least two full copies of it exist in Worker memory at once.

**Limits that actually bind — confirm each against our plan before designing:**

| Limit | Value | Where it bites |
|---|---|---|
| Anthropic request size | **32 MB** total request | A ~24 MB PDF is already over once base64-encoded |
| Anthropic PDF page count | **600 pages** (100 on 200K-context models) | Large evidence packages |
| Worker CPU time | **60 s**, configured via `limits.cpu_ms = 60000` (`wrangler.toml.example:21-22`) | Base64/JSON handling of large bodies |
| Worker memory | 128 MB per isolate | Multiple copies of a large base64 string |
| Cloudflare request body size | **Plan-dependent** — verify ours | Silent 413 before the Worker even runs |

**Mitigations, roughly cheapest first — apply only what the measurement justifies:**

1. **A file-size guard.** There is **none anywhere** today — not in the UI, not in the Worker — so an oversized evidence package fails opaquely. Even if everything else turns out fine, a clear "this package is too large, split it" message beats a mystery error, so this one is cheap to keep on the list.
2. **Stream the Anthropic response.** Keeps the connection alive and output flowing on a long scan instead of a silent multi-minute wait, and removes the truncation risk of a large non-streaming `max_tokens` (§7.6).
3. **Split the package into multiple calls** — a forms pass and an evidence pass, or per-form chunks — and merge findings. This is likely necessary anyway on page count and token budget for an AOS, and it lines up naturally with the forms/evidence split in §5.
4. **Anthropic Files API** — upload once, reference by `file_id`, instead of inlining base64 on every request. Takes the payload out of both our request body and the Worker's memory.
5. **Direct-to-R2 upload** from the browser, with the Worker fetching from R2. Consistent with the project rule that files live in R2, and it removes the base64-through-JSON path entirely.
6. **Make the scan an async job.** If wall-clock genuinely can't be contained, stop trying to answer in the request: queue the scan, return immediately, and use the email notification that already exists (`notifyProofScanComplete`) as the completion signal. This makes the timeout question permanently moot at the cost of a UX change.

---

## 7. Other weak spots found in code review

Grounded observations from reading the code. Each needs a decision — fix, or deliberately keep.

### 7.1 The editions table is read without its own staleness signal
`proof-scan.js:88-91` selects only `form_number, pages, edition_date`. Migration 1704 exists precisely because that table drifts from uscis.gov, and it added `check_status` (`unknown | current | stale | error`) plus `last_verified_at`. The scanner ignores both. **A known-stale edition is still fed to the model as ground truth** — the report will confidently pass a package filed on a superseded edition, and confidently fail a correct one. Also a false-positive source.

### 7.2 The prompt claims a refresh cadence that doesn't exist
`proof-scan.js:59` — *"updated daily from USCIS.gov."* The actual cron is **weekly** (`_worker.js:394`, `0 15 * * 1`), and only covers forms whose uscis.gov page parses.

### 7.3 `FALLBACK_EDITIONS` is badly out of date
15 forms hardcoded at `proof-scan.js:7`. `form_editions` now carries 30+ forms seeded by the `1600-*` migrations (I-129F, I-131, I-134, I-192, I-360, I-539/A, I-601/A, I-821, I-912, I-914/supA, I-918/supA/supB, N-600, AR-11, G-325A). If the DB read fails, the model silently gets a 2026-06 snapshot missing half the catalogue — the failure is swallowed by a bare `catch`.

### 7.4 Deterministic checks are being asked of an LLM
Rules 5, 7, and 9 are arithmetic, not judgment — and arithmetic done by prose is a false-positive generator. Routing numbers carry a **mod-10 ABA checksum** that is ~6 lines of code and catches every transposition; instead we ship a 40-bank lookup table inside the prompt, with undefined behaviour for any bank not on it. Extract structured facts with the model, validate in code. Pairs naturally with the structured output in §2.

### 7.5 The pass/fail signal is a substring match
`proof-scan.js:165`: `html.includes('NEEDS CORRECTION')`. The frontend then re-derives status by regex over table cells (`proof-scan.js:350-351`). Different phrasing, or those words appearing inside an issue description, silently corrupts the stored status. Structured output removes this class of bug entirely.

### 7.6 API call hygiene
- `model: 'claude-sonnet-4-6'` (`proof-scan.js:127`). This is a reasoning-heavy, high-stakes review where a miss means a USCIS rejection and a false positive wastes paralegal time. **`claude-opus-5` is the current default and is likely a bigger accuracy win than any individual rule edit.** Evaluate it before spending days on prompt wording.
- No `thinking` parameter. `thinking: {type: 'adaptive'}` with `output_config: {effort: 'high'}` fits this workload. (On Sonnet 4.6, omitting `thinking` means thinking is *off* — so today it runs with none.)
- `max_tokens: 4096` (`proof-scan.js:128`) for a full report over a 24-page I-485 package with a per-page edition table — and evidence findings will make reports longer. Truncation is plausible and **`stop_reason` is never checked**, so a report cut off mid-table is stored as a clean pass. Raise it (~16000) and check `stop_reason`; stream if it goes higher.
- `'anthropic-beta': 'pdfs-2024-09-25'` (`proof-scan.js:120`) — PDF input is GA; the header is obsolete. Harmless, but delete it.
- Optional: `cache_control: {type: 'ephemeral'}` on the system block. The prompt is large and stable per firm, so repeat scans within the TTL get the prefix cheap. Real but modest — the PDF dominates input tokens and is never cacheable across different files. Not the cost fix.

### 7.7 No tests
Nothing under `test/` references proof scan. The Vitest suite runs in real workerd (`vitest.config.mjs`, `test/wrangler.toml`) and `npm test` is required before merge.

---

## 8. Constraints Max must respect

- **Per-firm rules go in `custom_instructions`, not the base prompt.** This repo is the reusable IurisIQ template; `SYSTEM_PROMPT_BASE` ships to every client portal. Anything that is one firm's preference belongs in `proof_scan_config` via the UI. (The DACA/PIP specifics currently in the base prompt are arguably already over that line — worth raising, not fixing unilaterally.)
- **`form_editions` is firm-global reference data with RLS read-only** (`1704_form_edition_guard.sql:45-49`); all writes go through the service role. Don't add a client-side write path.
- **Migrations are the source of truth for schema.** New tables (`proof_scan_rules`, `proof_scan_evidence_requirements`, a bank routing table) need a migration in the correct range — never hand-edit the live DB.
- **Worker CPU limit is 60 s** (`limits.cpu_ms = 60000`, Workers Paid). Large packages already push against it.
- **Files live in R2**, never in the DB — the DB holds metadata and pointers.
- **Design system:** any UI change reuses the `.dk-*` kit in `css/portal.css` per `DESIGN-SYSTEM.md`. Verify in light **and** dark before commit.
- **`wrangler.toml` is gitignored** — use `wrangler.toml.example`. `ANTHROPIC_API_KEY` is a secret (`npx wrangler secret put ANTHROPIC_API_KEY`).

---

## 9. How to test

There is no harness today, so building one is part of the job — and it is the only thing that turns "fewer false positives" into a measurable claim instead of an impression.

1. **Assemble a fixture set with known verdicts.** Include, at minimum: a clean pass; a mixed-edition package with an old signature page; a PIP case with service-member documents; a DACA renewal with the I-765WS; a G-1650 with a bad routing number; a genuine name mismatch; and — critically — **several packages that are correct but have previously drawn false positives.** Redact real client data.
2. **Baseline before changing anything.** Run the current prompt over the set and record false positives and false negatives **per rule**. Since false positives are the stated problem, that number is the success metric; without a baseline there is no way to show the revamp worked.
3. **Track invented findings separately.** Any finding that maps to no defined rule is the §2 failure mode and should be counted on its own, not lumped in with ordinary false positives.
4. **`DEMO_MODE=true`** (`proof-scan.js:75-88`) bypasses the API and replays the most recent stored scan — useful for UI work, useless for rule work.
5. **`npm test`** before any merge (real workerd). Proof-scan coverage — prompt assembly, editions injection, staleness handling, status derivation, size guards — is cheap and currently absent.
6. **Sandbox deploy** per `CLAUDE.md`: regenerate `js/config.js` with `scripts/build-config.js`, then `npx wrangler deploy`.

---

## 10. Branch and deploy

- Proof scan code is **identical on `main` and `module/forms-page-reorg`** as of this writing, so branch from either.
- Work on `module/proof-scan-rules` per the branch-per-module rule. Never push half-built work to a deploy branch.
- **Production currently deploys from `module/forms-page-reorg`, not `main`.** Confirm with Rob before any client deploy — deploying `main` rolls features back.
- Deploy to clients only on a green test suite.

---

## 11. One possible order

Offered as a starting point — the sequencing rationale matters more than the sequence, so rearrange freely.

1. **Get the firm's proof checklist** (see the blocker note at the top), then build the **fixture set + baseline** (§9.1-9.3). Everything downstream is unmeasurable without these two, and the false-positive count is the whole point.
2. **Cheap correctness fixes needing no rule debate:** model choice, `max_tokens`, `stop_reason` check, obsolete beta header, `check_status` filtering, refreshed fallback string (§7.1-7.3, §7.6).
3. **Re-baseline.** Some "bad rules" may turn out to have been model or truncation failures. Worth knowing before rewriting any prose.
4. **Close the world** (§2): rule IDs, structured output with a closed `rule_id` enum, explicit scope statement, evidence-citation requirement. This is the fix for the actual complaint — do it before adding rules, so new rules land in a system that can't drift.
5. **Rules as data** (§2.2), then build the coverage matrix (§4): evaluate the existing nine against the checklist, edit what's wrong, add what's missing — each new rule landing with a fixture that must trip it and one that must not.
6. **Platform re-tune** (§6). Run the largest-real-AOS measurement early — it's cheap, it's Max's call to make, and it gates how item 3 gets built. Ship the size guard regardless; take the rest of the mitigation ladder only as far as the measurement justifies.
7. **Evidence checks** (§5) — last, because it depends on the closed-world machinery and on the platform work, and because it is the fastest way to undo the false-positive gains if built free-form.
8. **Regression tests** so the next revamp starts from a harness instead of from scratch.

---

*Questions on intent or priorities → Rob. Questions on where something lives → this document, then the code.*
