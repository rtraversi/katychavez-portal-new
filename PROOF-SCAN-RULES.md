# Proof Scan — Rule Catalog (working draft)

**Status:** working document for the rules revamp. Rob + Max edit this directly.
**Companion:** `PROOF-SCAN-HANDOFF.md` (why the revamp, architecture, platform limits, test plan).
**Source of truth today:** `functions/api/proof-scan.js:9-72` (`SYSTEM_PROMPT_BASE`). This file is a
restructured view of that prompt — **editing this file changes nothing yet.** Once the catalog settles,
it becomes either the new prompt text or the seed rows for a `proof_scan_rules` table (handoff §2.2).

---

## How to use this document

Every rule is one block with the same fields. Edit in place; add new rules by copying the template in
§9. Keep IDs stable once assigned — they are intended to become the closed `rule_id` enum in structured
output (handoff §2.1), so a retired rule's ID is retired with it and never reused.

**Field meanings**

| Field | What goes in it |
|---|---|
| **Applies to** | Which forms/documents the rule may fire on. `ALL` means any page in the package. A rule that fires outside this list is a bug. |
| **Condition** | The exact test, stated so that two people would flag the same thing. If you can't write it this precisely, the rule isn't ready. |
| **Do NOT flag** | Scope conditions — the cases that look like a hit but aren't. These are today's `NOTES` block, reattached to the rules they actually modify. |
| **Engine** | `model` = the LLM judges it · `code` = deterministic, should be validated in our own code · `hybrid` = model extracts the fact, code validates it |
| **FP risk** | How likely this rule is to produce a false positive today, and why |
| **Severity** | `error` / `warning` / `advisory`. **Not implemented today** — every current finding is reported at the same weight. Filling this column is part of the revamp. |
| **Review** | Your decision this round: keep / edit / retire, plus notes |
| **Fixtures** | The package that must trip it, and the package that must not. Required for every rule per handoff §4. |

**ID bands**

| Band | Area |
|---|---|
| `PS-0xx` | Scope & role resolution (preamble — not findings) |
| `PS-1xx` | Form integrity — editions, page counts, assembly, quality |
| `PS-2xx` | Signatures & dates |
| `PS-3xx` | Cross-form consistency — name, A-Number, address |
| `PS-4xx` | Fees & payment forms |
| `PS-5xx` | Representation (G-28) |
| `PS-6xx` | Form-set completeness by case type |
| `PS-7xx` | Evidence by case type |
| `OUT-x` | Output contract |
| `REF-x` | Reference data the rules depend on |

**Legend:** ✅ active in the prompt today · 🆕 proposed, not built · ⚠️ active but flagged as a problem

---

## 1. Scope & role resolution (PS-0xx)

These are not findings — they are the frame the model applies before any rule fires. They exist almost
entirely to *suppress* false positives, so they are load-bearing for the current ask.

---

### PS-001 — Closed world: report only defined rules ⚠️ MISSING

| | |
|---|---|
| **Applies to** | ALL |
| **Engine** | structural (prompt + output schema) |
| **Severity** | n/a |
| **FP risk** | — **this rule's absence is the root cause of the false-positive problem** |

**Condition (proposed):** Report ONLY findings that correspond to one of the rule IDs defined in this
catalog. If something appears unusual but matches no rule, do not report it. Do not assess legal
sufficiency, eligibility, filing strategy, or case merits.

**Do NOT flag:** anything not on this list, however wrong it looks.

**Why it's here:** the prompt today says *"check for the issues listed below"* — which is not the same
as *"check only these."* The output table's free-text `Issue` column then makes an invented finding
expressible. Handoff §2 argues the durable fix is a closed `rule_id` enum in structured output, not
more prose.

**Review:** ☐ keep ☐ edit ☐ retire — notes: ______________________________________________

---

### PS-002 — Beneficiary vs. petitioner/sponsor identification ✅

| | |
|---|---|
| **Applies to** | ALL (runs before PS-301) |
| **Engine** | model |
| **Severity** | n/a — framing, not a finding |
| **FP risk** | n/a (exists to *reduce* FPs on PS-301) |

**Condition:** Before any name check, identify the case type and each party's role.
- **Beneficiary (applicant)** — the foreign national whose benefit is sought. Their name must match
  across all USCIS forms and their own supporting documents.
- **Petitioner / sponsor** — a separate person filing on the beneficiary's behalf (USC spouse on I-130,
  LPR sponsor on I-864, service member on an I-131 PIP case).

**Do NOT flag:** supporting documents belonging to the petitioner (birth certificates, military IDs,
military orders, naturalization certificates, passports) being in the petitioner's name. That is correct.

**Review:** ☐ keep ☐ edit ☐ retire — notes: ______________________________________________

---

### PS-003 — Military Parole in Place (PIP) role handling ✅

| | |
|---|---|
| **Applies to** | I-131 filed under 8 CFR 212.5(b) / INA 212(d)(5) |
| **Engine** | model |
| **Severity** | n/a — framing |
| **FP risk** | n/a (exists to *reduce* FPs) |

**Condition:** On PIP cases (parents/spouses/children of active-duty US military), the **service member
is the petitioner**. Their documents — birth certificate, military ID, deployment orders, DD-214 — will
be in the service member's name.

**Do NOT flag:** service-member documents as a name inconsistency.

**Still enforced on PIP cases:** the beneficiary's name must be consistent across all USCIS forms;
the G-28 attorney of record should cover the beneficiary.

**⚠ Template concern (handoff §8):** PIP and DACA specifics are firm-practice detail sitting in
`SYSTEM_PROMPT_BASE`, which ships to *every* IurisIQ client portal. Decide whether these belong in the
base prompt or in per-firm `custom_instructions`. Applies equally to PS-203, PS-501, PS-103.

**Review:** ☐ keep ☐ edit ☐ retire ☐ move to custom_instructions — notes: ____________________

---

## 2. Form integrity (PS-1xx)

---

### PS-101 — Form edition date, per page ✅

| | |
|---|---|
| **Applies to** | every page of every USCIS form |
| **Engine** | hybrid (model reads footers → code compares to `form_editions`) |
| **Severity** | ☐ error ☐ warning ☐ advisory |
| **FP risk** | **High** — depends entirely on REF-1 being current. A stale editions table fails a correct package and passes a bad one. |

**Condition:** Read the edition date printed in the footer of **every page** of every form. Flag:
- **(a)** any page whose footer edition date ≠ the current USCIS published edition for that form — note the page number
- **(b)** any form whose pages carry inconsistent edition dates among themselves — this means a signature
  page (or other page) from an older edition was inserted into a current-edition package. Call out which
  page(s) carry the old date.

**Note in prompt:** "This per-page check is critical" — mixed-edition packages are common.

**Do NOT flag:** *(none defined today)*

**Open issues:**
- ⚠ The scan reads `form_number, pages, edition_date` only and **ignores `check_status` and
  `last_verified_at`** from migration 1704 — a known-stale edition is fed to the model as ground truth
  (handoff §7.1). Decide the behaviour: suppress the rule for stale forms, or downgrade to advisory.
- ⚠ Prompt claims editions are *"updated daily from USCIS.gov"*; the cron is **weekly** (handoff §7.2).

**Fixtures:** must trip → mixed-edition package w/ old signature page · must not trip → clean current-edition package

**Review:** ☐ keep ☐ edit ☐ retire — notes: ______________________________________________

---

### PS-102 — Page count per form ✅

| | |
|---|---|
| **Applies to** | every form identified in the package |
| **Engine** | hybrid (model identifies forms → code compares count to `form_editions.pages`) |
| **Severity** | ☐ error ☐ warning ☐ advisory |
| **FP risk** | Medium — depends on REF-1 page counts being right, and on correct form-boundary detection in a merged PDF |

**Condition:** Flag missing or extra pages for each form identified, against the expected page count.

**Do NOT flag:** *(none defined today — consider: forms legitimately filed with supplements/addenda)*

**Fixtures:** must trip → ______________ · must not trip → ______________

**Review:** ☐ keep ☐ edit ☐ retire — notes: ______________________________________________

---

### PS-103 — Blank or duplicate pages ✅

| | |
|---|---|
| **Applies to** | ALL |
| **Engine** | model |
| **Severity** | ☐ error ☐ warning ☐ advisory |
| **FP risk** | Medium — "duplicate" is under-defined; identical blank form pages across a package look alike |

**Condition:** Flag blank pages and duplicate pages.

**Do NOT flag:** multiple **G-1450** and/or **G-1650** forms in a single package — one per filing fee is
normal and expected. Not duplicates.

**⚠ Redundancy:** this G-1450/G-1650 exception is stated **three times** in the current prompt (inline
here, in NOTES, and again alongside the routing rule). Consolidate to one place — repetition competes
for attention with the checks that matter (handoff §3).

**Fixtures:** must trip → ______________ · must not trip → DACA package w/ 2× G-1450

**Review:** ☐ keep ☐ edit ☐ retire — notes: ______________________________________________

---

### PS-104 — Page order / assembly 🆕 PROPOSED

| | |
|---|---|
| **Applies to** | ALL |
| **Engine** | model |
| **Severity** | ☐ error ☐ warning ☐ advisory |
| **FP risk** | Medium |

**Condition (draft):** Flag pages of one form interleaved into another, or a form's pages out of
sequential order.

**Do NOT flag:** ______________________________________________

**Review:** ☐ add ☐ drop — notes: ______________________________________________

---

### PS-105 — Legibility / scan quality 🆕 PROPOSED

| | |
|---|---|
| **Applies to** | ALL |
| **Engine** | model |
| **Severity** | ☐ error ☐ warning ☐ advisory |
| **FP risk** | Medium-high — "unreadable" is subjective; needs a concrete threshold |

**Condition (draft):** Flag cut-off pages, rotated pages, and pages scanned at a resolution that makes
printed text unreadable. Common real-world rejection cause, currently unchecked.

**Do NOT flag:** ______________________________________________

**Review:** ☐ add ☐ drop — notes: ______________________________________________

---

### PS-106 — Barcode / form-type confirmation 🆕 PROPOSED

| | |
|---|---|
| **Applies to** | USCIS forms carrying a 2D barcode |
| **Engine** | ☐ model ☐ code |
| **Severity** | ☐ error ☐ warning ☐ advisory |
| **FP risk** | Low if code-validated; high if the model reads barcodes by eye |

**Condition (draft):** Verify the form each page claims to be actually matches the form it was filed under.

**Review:** ☐ add ☐ drop — notes: ______________________________________________

---

### PS-107 — Checkbox / field completeness 🆕 PROPOSED — ⚠ FP MAGNET

| | |
|---|---|
| **Applies to** | ☐ specify per form — **do not leave as ALL** |
| **Engine** | model |
| **Severity** | ☐ error ☐ warning ☐ advisory |
| **FP risk** | **High** — flagged in handoff §4 as the single most likely new rule to reintroduce the FP problem |

**Condition (draft):** On a *named, narrow* list of high-risk fields per form, flag blanks. Define the
exact field list per form or don't ship the rule.

**Fields in scope:** ______________________________________________

**Review:** ☐ add ☐ drop — notes: ______________________________________________

---

## 3. Signatures & dates (PS-2xx)

---

### PS-201 — Required signatures ✅

| | |
|---|---|
| **Applies to** | all applicable forms |
| **Engine** | model |
| **Severity** | ☐ error ☐ warning ☐ advisory |
| **FP risk** | Medium — "applicable" is undefined; the exception list is exception-by-exception |

**Condition:** Flag missing applicant and attorney/preparer signatures on all applicable forms.

**Do NOT flag:**
- **I-765WS** — does not require a signature. *(Stated twice in the current prompt — consolidate.)*

**Open question:** which forms require *which* signatures should be a per-form column on REF-1, not prose.

**Fixtures:** must trip → ______________ · must not trip → DACA renewal w/ unsigned I-765WS

**Review:** ☐ keep ☐ edit ☐ retire — notes: ______________________________________________

---

### PS-202 — Signature date order ❌ retired

| | |
|---|---|
| **Status** | Retired 2026-08-28 by product decision |
| **Reason** | Do not assess or report attorney/applicant signature-date order. |

**Implementation:** Removed from the active scan prompt and output cross-check. This ID is retained only as a historical record and must not be reused.

---

### PS-203 — I-821D items 6, 7, 8 not applicable ✅ (suppression-only)

| | |
|---|---|
| **Applies to** | I-821D |
| **Engine** | model |
| **Severity** | n/a — pure suppression |
| **FP risk** | n/a (exists to *reduce* FPs) |

**Condition:** None — this rule only suppresses.

**Do NOT flag:** I-821D **Items 6, 7, and 8** (education guideline, school name, graduation date) as
missing or incomplete. They apply only to *initial* DACA submissions, and the government is currently
accepting **renewals only**.

**⚠ Time-sensitive:** this is a policy snapshot hardcoded in a prompt. If initial DACA filings resume,
this suppression starts hiding real errors. Needs an owner and a review date.
**Also:** firm/practice-specific — see the template concern in PS-003.

**Review date owner:** ______________  **Next review:** ______________

**Review:** ☐ keep ☐ edit ☐ retire ☐ move to custom_instructions — notes: ____________________

---

### PS-204 — Signature freshness 🆕 PROPOSED

| | |
|---|---|
| **Applies to** | all signed forms |
| **Engine** | hybrid (model extracts dates → code compares) |
| **Severity** | ☐ error ☐ warning ☐ advisory |
| **FP risk** | Low if the threshold is explicit; high if left to judgment |

**Condition (draft):** Flag signatures dated implausibly long before the filing date.

**Threshold:** ______ days. *(Must be a number, not "implausibly long.")*

**Review:** ☐ add ☐ drop — notes: ______________________________________________

---

## 4. Cross-form consistency (PS-3xx)

---

### PS-301 — Beneficiary name consistency ✅ ⚠ PRIMARY FP SOURCE

| | |
|---|---|
| **Applies to** | all USCIS forms + beneficiary supporting documents |
| **Engine** | model (judgment — the only genuinely non-mechanical rule in the set) |
| **Severity** | ☐ error ☐ warning ☐ advisory |
| **FP risk** | **High** — the entire PS-002/PS-003 preamble exists to defend this one rule |

**Condition:** The **beneficiary's** name must match across all USCIS forms and the beneficiary's own
supporting documents.

**Do NOT flag:**
- Petitioner/sponsor documents in a different name — expected (PS-002).
- Service-member documents on a PIP case (PS-003).
- When a supporting document (birth certificate, passport, military ID) is in a name different from the
  beneficiary, **first determine whether it logically belongs to the petitioner or a third party**
  before flagging. *(Stated in the preamble and again in NOTES — consolidate.)*

**Undefined today — decide:** are these mismatches?
☐ maiden vs. married name ☐ middle name present on one form, absent on another ☐ hyphenation /
two surnames ☐ accents & diacritics ☐ transliteration variants ☐ suffix (Jr./III) ☐ name order reversal

**Fixtures:** must trip → genuine mismatch · must not trip → PIP package w/ service-member docs

**Review:** ☐ keep ☐ edit ☐ retire — notes: ______________________________________________

---

### PS-302 — A-Number consistency ✅

| | |
|---|---|
| **Applies to** | all forms where an A-Number appears |
| **Engine** | **should be code** — string normalization + compare (handoff §7.4) |
| **Severity** | ☐ error ☐ warning ☐ advisory |
| **FP risk** | Low |

**Condition:** The A-Number must match across all forms where present.

**Do NOT flag:** formatting differences. `A-XXXXXXXXX` and `XXX-XXX-XXX` are equivalent formats — flag
only if the underlying **digits** actually differ.

**Undefined today — decide:** ☐ leading-zero padding (A-012345678 vs A-12345678) ☐ 8- vs 9-digit A-numbers

**Fixtures:** must trip → ______________ · must not trip → same A# in both formats

**Review:** ☐ keep ☐ edit ☐ retire — notes: ______________________________________________

---

### PS-303 — Mailing address consistency ✅

| | |
|---|---|
| **Applies to** | all forms carrying a mailing address |
| **Engine** | model (mostly mechanical, but needs normalization rules) |
| **Severity** | ☐ error ☐ warning ☐ advisory |
| **FP risk** | Medium — no normalization rules defined, so cosmetic variants read as mismatches |

**Condition:** The mailing address must match across forms.

**Do NOT flag:** *(none defined today — this is a gap)*

**Undefined today — decide:** ☐ `St` vs `Street`, `Apt` vs `#` ☐ ZIP vs ZIP+4 ☐ case/punctuation
☐ **a deliberately different safe mailing address vs. physical address** ☐ c/o lines
☐ attorney's address in the "mailing" block

**Fixtures:** must trip → ______________ · must not trip → ______________

**Review:** ☐ keep ☐ edit ☐ retire — notes: ______________________________________________

---

## 5. Fees & payment (PS-4xx)

---

### PS-401 — G-1650 bank routing number validation ✅

| | |
|---|---|
| **Applies to** | **G-1650 only** (ACH bank draft) |
| **Engine** | **should be code** — see below |
| **Severity** | ☐ error ☐ warning ☐ advisory |
| **FP risk** | **High for any bank not in the inline list** — behaviour is undefined there |

**Condition:** Validate the routing number on any G-1650 found: does the routing number correspond to
the bank named on the form?

**Do NOT flag:**
- **G-1450** — the credit-card equivalent. It carries no routing number and requires no bank validation.
  *(Stated twice — consolidate.)*
- Multiple G-1650s in one package (see PS-103).

**⚠ Method problem (handoff §7.4):** validation is done against a **41-entry bank list embedded in the
prompt** (REF-2). Routing numbers carry a **mod-10 ABA checksum** — ~6 lines of code that catches every
transposition, for every bank. Decide: checksum in code, a real routing table in the DB, or both.

**Fixtures:** must trip → G-1650 w/ bad routing number · must not trip → G-1650 drawn on a bank not in REF-2

**Review:** ☐ keep ☐ edit ☐ retire — notes: ______________________________________________

---

### PS-402 — Fee coverage: one payment form per filing fee due 🆕 PROPOSED

| | |
|---|---|
| **Applies to** | G-1450, G-1650 vs. the forms present |
| **Engine** | hybrid |
| **Severity** | ☐ error ☐ warning ☐ advisory |
| **FP risk** | Medium — needs a fee schedule as reference data, and fee waivers/exemptions handled |

**Condition (draft):** Verify the count of payment forms matches the filing fees actually due for the
forms in the package. Today multiple payment forms are merely *tolerated* (PS-103) — nothing checks the
count is right.

**Do NOT flag:** ☐ fee-waiver cases (I-912) ☐ fee-exempt filings ☐ ______________

**Depends on:** a fee schedule per form + edition. Does not exist yet. → REF-3

**Review:** ☐ add ☐ drop — notes: ______________________________________________

---

## 6. Representation (PS-5xx)

---

### PS-501 — G-28 coverage 🆕 PROPOSED (partially present as a suppression only)

| | |
|---|---|
| **Applies to** | G-28 |
| **Engine** | model |
| **Severity** | ☐ error ☐ warning ☐ advisory |
| **FP risk** | Medium |

**Condition (draft):** A G-28 attorney of record form exists for each applicant/petitioner on the
package, and names the right party on each.

**Do NOT flag (already in the prompt today):**
- For **DACA (I-821D)** packages, the **I-765WS is never listed on the G-28** — do not flag its absence
  from the G-28.

**Note:** today the *only* G-28 logic in the prompt is that suppression plus a passing mention in PS-003.
There is no affirmative coverage check. This rule would add one.

**Review:** ☐ add ☐ drop — notes: ______________________________________________

---

## 7. Form-set completeness by case type (PS-6xx) 🆕 ALL PROPOSED

The form-level sibling of the evidence checklists in §8. Same closed-list discipline applies: build from
the firm's checklist, never from the model's own knowledge of practice.

| ID | Case type | Rule (draft) | Add? |
|---|---|---|---|
| PS-601 | AOS (I-485) | I-485 present without required I-693 / I-864 where applicable | ☐ |
| PS-602 | Marriage-based I-130 | I-130 without I-130A when the beneficiary is a spouse | ☐ |
| PS-603 | ______________ | ______________ | ☐ |
| PS-604 | ______________ | ______________ | ☐ |

**Blocking question (handoff §5):** how is case type determined — inferred from the forms present, or
selected by the user at upload? A wrong case type produces a wholly wrong checklist for both §7 and §8.

**Decision:** ☐ infer ☐ user-selected at upload ☐ user-selected w/ inferred default

---

## 8. Evidence by case type (PS-7xx) 🆕 ALL PROPOSED

**The highest-risk section in the revamp.** "What evidence is missing?" is open-ended by nature and is
the fastest way to undo every false-positive gain (handoff §5). Build it as a **closed** question: for
each row on a fixed per-case-type checklist, is a document satisfying it present — **yes / no / unclear**?
The model classifies what it sees against a fixed list; it never proposes new requirements.

Intended home: a firm-editable `proof_scan_evidence_requirements` table keyed by case type.

**Checklist template — one table per case type:**

### Case type: ______________________ (primary form: ____________)

| ID | Evidence item | Required / Recommended | Accepted alternatives | Notes |
|---|---|---|---|---|
| PS-7__ | | ☐ req ☐ rec | | |
| PS-7__ | | ☐ req ☐ rec | | |
| PS-7__ | | ☐ req ☐ rec | | |

*(Copy this table per case type. Candidates to cover: AOS · marriage-based I-130 · DACA renewal ·
Military PIP · N-400 · I-751 · I-765 standalone · ______________)*

**Decisions needed before any of this gets built:**
- ☐ **Is "unclear" a failure?** A blurry utility bill that might be a joint-residence document should
  probably not be reported like an absent one. Proposed: `unclear` → advisory, never error.
- ☐ **Who maintains the checklists** — shipped defaults in the template + per-firm overrides, or
  firm-authored from scratch?
- ☐ **Same scan pass or separate?** Evidence packages are far larger than form packages — this has hard
  platform implications (handoff §6).

---

## 9. New rule template

Copy this block for anything new.

```
### PS-___ — <name> 🆕 PROPOSED

| | |
|---|---|
| **Applies to** | <forms/documents — never leave as ALL without meaning it> |
| **Engine** | ☐ model ☐ code ☐ hybrid |
| **Severity** | ☐ error ☐ warning ☐ advisory |
| **FP risk** | <low/med/high + why> |

**Condition:** <the exact test, precise enough that two people flag the same thing>

**Do NOT flag:** <the near-misses>

**Depends on:** <reference data this rule needs>

**Fixtures:** must trip → ____________ · must not trip → ____________

**Review:** ☐ add ☐ drop — notes: ____________
```

---

## 10. Output contract (OUT-x)

What the scan is required to return. Today this is free-form HTML; handoff §2.1 argues it should become
structured JSON with the HTML rendered on our side.

| ID | Requirement | Status |
|---|---|---|
| OUT-1 | Valid HTML only — no Markdown | ✅ active |
| OUT-2 | Summary section: overall status **PASS / NEEDS CORRECTION**, plus identified case type and the names of beneficiary and petitioner/sponsor where determinable | ✅ active |
| OUT-3 | An HTML table: `Status \| Form/Document \| Issue \| Detail` | ⚠ the free-text `Issue` column is what makes invented findings expressible |
| OUT-4 | A cross-check section: beneficiary name consistency, A-Number, address | ✅ active |
| OUT-5 | A Bank Validation section when a G-1650 is present: routing number, bank name on form, expected bank, match status | ✅ active |
| OUT-6 | Every finding carries a `rule_id` from a closed enum | 🆕 proposed |
| OUT-7 | Every finding cites page number + the quoted text it relied on — uncitable findings get filtered automatically | 🆕 proposed |
| OUT-8 | Every finding carries a severity/confidence so borderline calls surface as advisory | 🆕 proposed |

**⚠ Status derivation is a substring match today:** `proof-scan.js:165` does
`html.includes('NEEDS CORRECTION')`, and the frontend re-derives status by regex over table cells
(`proof-scan.js:350-351`). Those words appearing inside an issue description silently corrupt the
stored status. OUT-6 removes this class of bug.

---

## 11. Reference data the rules depend on (REF-x)

| ID | Data | Where | Feeds | State |
|---|---|---|---|---|
| REF-1 | **Form editions** — form number, page count, edition date | `form_editions` table, injected at `{{FORM_EDITIONS}}` | PS-101, PS-102 | Live. 30+ forms. Weekly cron sets `check_status`, which **the scan ignores** (handoff §7.1) |
| REF-2 | **Bank routing list** — 41 entries | hardcoded in `SYSTEM_PROMPT_BASE` | PS-401 | ⚠ Should be a checksum in code and/or a real table (handoff §7.4) |
| REF-3 | **Fee schedule** per form/edition | — | PS-402 | Does not exist |
| REF-4 | **Evidence requirements** per case type | — | PS-7xx | Does not exist |
| REF-5 | **Per-firm custom instructions** | `proof_scan_config.custom_instructions`, appended after the base prompt | all | Live, firm-editable from the UI |

### REF-1 fallback string — ⚠ stale

`FALLBACK_EDITIONS` (`proof-scan.js:7`) hardcodes **15 forms** as of 2026-06-24. If the DB read fails —
and the failure is swallowed by a bare `catch` — the model silently gets a snapshot missing half the
catalogue that the `1600-*` migrations added (I-129F, I-131, I-134, I-192, I-360, I-539/A, I-601/A,
I-821, I-912, I-914/supA, I-918/supA/supB, N-600, AR-11, G-325A).

| Form | Pages | Edition |
|---|---|---|
| G-1145 | 1 | 09/26/14 |
| G-1450 | 1 | 06/03/25 |
| G-1650 | 1 | 06/03/25 |
| G-28 | 4 | 09/17/18 |
| I-90 | 7 | 01/20/25 |
| I-130 | 12 | 04/01/24 |
| I-130A | 6 | 04/01/24 |
| I-131 | 14 | 01/20/25 |
| I-485 | 24 | 01/20/25 |
| I-751 | 11 | 04/01/24 |
| I-765 | 7 | 08/21/25 |
| I-765WS | 1 | 08/21/25 |
| I-821D | 7 | 01/20/25 |
| I-864 | 12 | 10/17/24 |
| N-400 | 14 | 01/20/25 |

### REF-2 bank routing list (as embedded in the prompt)

Bank of America `026009593` `021001208` `026012881` · Capital One `021052053` `056073502` `051405515`
`065000090` · Citibank `021000089` · Citizens Bank `011401533` `241070417` · HSBC `021300077` ·
Huntington `042101706` `044201847` · JPMorgan Chase `021000021` `021202337` `044000037` `071000013`
`322271627` · KeyBank `022000020` `041001039` · Navy Federal `314972853` `256074974` ·
PNC Bank `083000108` `041000124` `054000030` `031000053` · TD Bank `031100649` `011103093` `267084131` ·
Truist `261271694` `053101121` `055002707` · US Bank `121122676` `091000022` `071904779` `081000210` ·
USAA `311079674` `114994196` · Wells Fargo `021200339` `053000219`

---

## 12. Consolidation worklist

Redundancy and contradictions found in the current prompt. Each is a false-positive surface or wasted
model attention — resolve while editing.

| # | Issue | Appears | Action |
|---|---|---|---|
| 1 | I-765WS signature exemption | 2× (PS-201 inline + NOTES) | ☐ state once on PS-201 |
| 2 | G-1450/G-1650 "not duplicates" | 3× (PS-103 inline + NOTES + PS-401 area) | ☐ state once on PS-103 |
| 3 | Petitioner-name exception | 3× (PS-002 preamble + PS-301 inline + NOTES) | ☐ state once on PS-002 |
| 4 | G-1450 has no routing number | 2× (PS-401 inline + NOTES) | ☐ state once on PS-401 |
| 5 | Prompt says editions update **daily**; cron is **weekly** | `proof-scan.js:59` vs `_worker.js:394` | ☐ fix the text |
| 6 | Whole NOTES block is negative — 7 × "do not flag X" | `proof-scan.js:63-68` | ☐ each note becomes a scope condition on a rule, or is deleted once PS-001 closes the world |

---

## 13. Open decisions

Everything blocking, in one place.

| # | Decision | Owner | Status |
|---|---|---|---|
| 1 | **Produce the firm's actual proof checklist.** The 9 rules above are what the *code* does — not evidence of what the firm's checklist says. Coverage can't be assessed without it, and guessing recreates the FP problem. | Rob + paralegals | ☐ open |
| 2 | How is case type determined — inferred or user-selected at upload? | Rob | ☐ open |
| 3 | Is evidence "unclear" a failure, or advisory? | Rob | ☐ open |
| 4 | Who maintains evidence checklists — template defaults + firm overrides, or firm-authored? | Rob | ☐ open |
| 5 | Do DACA/PIP specifics stay in the shared template prompt, or move to per-firm `custom_instructions`? | Rob + Max | ☐ open |
| 6 | Severity model — adopt error/warning/advisory, or keep everything at one weight? | Rob + Max | ☐ open |
| 7 | Which rules move from model to code (PS-302 and PS-401 are the candidates; PS-202 was retired 2026-08-28) | Max | ☐ open |
| 8 | Rules as data (`proof_scan_rules` table) vs. staying in the prompt string? | Max | ☐ open |
| 9 | PS-203 (DACA items 6-8) needs an owner and a review date — it's a policy snapshot that will go stale | Rob | ☐ open |

---

## 14. Rule count summary

| | Active today | Proposed | Total |
|---|---|---|---|
| Scope / role (PS-0xx) | 2 | 1 | 3 |
| Form integrity (PS-1xx) | 3 | 4 | 7 |
| Signatures & dates (PS-2xx) | 2 | 1 | 3 |
| Cross-form consistency (PS-3xx) | 3 | 0 | 3 |
| Fees & payment (PS-4xx) | 1 | 1 | 2 |
| Representation (PS-5xx) | 0 (suppression only) | 1 | 1 |
| Form-set completeness (PS-6xx) | 0 | 2+ | 2+ |
| Evidence (PS-7xx) | 0 | TBD | TBD |
| **Total** | **11** | **10+** | **21+** |

Plus 8 output-contract requirements (5 active, 3 proposed) and 5 reference-data dependencies (3 live,
2 nonexistent).
