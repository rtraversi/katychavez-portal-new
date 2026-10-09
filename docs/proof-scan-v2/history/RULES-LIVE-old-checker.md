# The live rules — every rule actually running in production

Extracted verbatim from `functions/api/proof-scan.js` on 2026-08-21 (6,147 chars assembled).
This is the **code**, not Rob's proposed catalog. Where a live rule matches a `PS-` ID from
`PROOF-SCAN-RULES.md`, the ID is given so the two documents can be worked together.

**Everything below is one prompt string.** There is no rule engine. Editing a rule means
editing prose. Nothing here is executable code.

> Regenerate the raw text any time:
> `cd ~/sites/proof-scan-lab && node lib/extract-prompt.js`

---

## A. Preamble — role resolution (2 blocks)

| ID | PS | What it does | Notes |
|---|---|---|---|
| **LIVE-P1** | PS-002 ✅ | Beneficiary vs. petitioner/sponsor. Petitioner's own documents in the petitioner's name are correct and must NOT be flagged as a name mismatch. | Exists purely to suppress a false positive on rule 6. |
| **LIVE-P2** | PS-003 ✅ | Military Parole in Place (I-131 under 8 CFR 212.5(b)). Service member is the petitioner; their documents are in their name. G-28 should cover the beneficiary. | Firm-specific. Handoff §8 flags that DACA/PIP specifics arguably belong in `custom_instructions`, not the shared base prompt. |

---

## B. The nine checks

These are the entire rule set. Numbered exactly as the prompt numbers them.

| # | ID | PS | Rule | Nature | Edit risk |
|---|---|---|---|---|---|
| 1 | **LIVE-R1** | PS-101 ✅ | Edition date in the footer of **every page** of every form vs. the current USCIS edition. Sub-check (b): inconsistent editions *within* one form, i.e. an old signature page inserted into a current package. | Objective | Depends on the editions reference being right. See §D. |
| 2 | **LIVE-R2** | PS-102 ✅ | Page count per form. | Objective | Same dependency. |
| 3 | **LIVE-R3** | PS-103 ✅ | Blank or duplicate pages. G-1450/G-1650 duplicates exempted inline. | Objective | Exemption duplicated in NOTE-2. **⚠ N-003: the exemption tolerates ANY number of payment forms. Nothing checks the count against fees actually due. No PS number exists for fee coverage.** |
| 4 | **LIVE-R4** | PS-201 ✅ | Required signatures, applicant + attorney/preparer. I-765WS exempted inline. | Objective | Exemption duplicated in NOTE-4. |
| 5 | ~~**LIVE-R5**~~ | PS-202 ✅ → **RETIRE** | ~~Attorney must not sign before the applicant.~~ | Arithmetic | 🔴 **DECISION 2026-08-21 — DELETE. Rob and Max agreed: signature date order is not a thing for this firm.** See NOTES N-005. Removes one of the three prose-arithmetic rules outright. PS-202 needs retiring in Rob's catalog too, not just here. |
| 6 | **LIVE-R6** | PS-301 ✅ **⚠ PRIMARY FP SOURCE** | Beneficiary name consistency across forms and beneficiary supporting docs. Petitioner docs in a different name expected. | **Judgment** | The single biggest false-positive generator. Both preamble blocks exist to defend it. **⚠ N-006: knows only 2 roles. Needs 4 — beneficiary, petitioner/sponsor, joint sponsor, I-864A household member — resolved PER CASE. Same root cause as the forms-side per-case-context finding.** |
| 7 | **LIVE-R7** | PS-302 ✅ | A-Number consistency. `A-XXXXXXXXX` and `XXX-XXX-XXX` treated as equivalent; flag only if digits differ. | Arithmetic | §7.4. |
| 8 | **LIVE-R8** | PS-303 ✅ | Mailing address consistency across forms. | Mostly objective | |
| 9 | **LIVE-R9** | PS-401 ✅ | G-1650 routing number validated against a 40-bank inline list. G-1450 is credit card, no routing. | Arithmetic | §7.4: routing numbers carry a mod-10 ABA checksum, ~6 lines of code. Undefined behaviour for any bank not on the list. |

---

## C. NOTES — the accretion layer (6 bullets)

Every one of these is a suppression, added after a false positive happened. Handoff §2 calls
this the fingerprint of an open-world prompt being fought one bug at a time.

| ID | PS | Suppression | Duplicate of |
|---|---|---|---|
| **NOTE-1** | | G-1450/G-1650 need no date next to the signature. | |
| **NOTE-2** | | G-1450 = credit card, G-1650 = ACH. Multiples in one package are normal, not duplicates. Only G-1650 has a routing number. | Repeats the duplicate exemption from LIVE-R3 and the routing/credit-card split from LIVE-R9. |
| **NOTE-3** | | DACA (I-821D): the I-765WS is never on the G-28 attorney of record. | |
| **NOTE-4** | | I-765WS needs no signature. | Repeats the exemption already inside LIVE-R4. |
| **NOTE-5** | PS-203 ✅ | I-821D items 6, 7, 8 apply to initial DACA only; the government accepts renewals only. | Time-sensitive claim about government policy, frozen in a prompt string. |
| **NOTE-6** | | A supporting document in a different name may belong to the petitioner or a third party. Determine before flagging. | Third defence of LIVE-R6. |

**Note on counting:** the handoff says "seven exceptions." There are **6 bullets**; NOTE-2
carries two distinct exceptions in one sentence, which is presumably the seventh.

**Verified redundancy to clean up:** the I-765WS signature exemption appears in both LIVE-R4
and NOTE-4. The G-1450/G-1650 duplicate exemption appears in both LIVE-R3 and NOTE-2. The
credit-card/ACH split appears in both LIVE-R9 and NOTE-2. Repetition is not free; it competes
for attention with the checks that matter.

---

## D. Reference data baked into the prompt

| ID | Content | Problem |
|---|---|---|
| **REF-1** | USCIS form editions, **15 forms**, format `I-485\|24p\|01/20/25` | Injected at `{{FORM_EDITIONS}}`. In production this comes from the `form_editions` table; the 15-form string is only the fallback. **The table carries 32 forms.** |
| **REF-2** | Bank routing numbers, 40 entries | Undefined behaviour for any bank not listed. §7.4 argues this should be a checksum, not a lookup table. |

**REF-1 carries a false claim in its own header:** the prompt says the editions are
*"updated daily from USCIS.gov."* The actual cron is **weekly** — `_worker.js:394` handles
`0 15 * * 1`, Mondays. Handoff §7.2. The model is being told its reference data is fresher
than it is.

---

## E. Output contract

| ID | OUT | Requirement |
|---|---|---|
| **OUT-A** | OUT-1 | Valid HTML only, no Markdown. |
| **OUT-B** | OUT-2 | Summary: overall PASS / NEEDS CORRECTION, case type, beneficiary and petitioner names where determinable. |
| **OUT-C** | OUT-3 ⚠ | Table: `Status \| Form/Document \| Issue \| Detail`. The free-text Issue column is what makes invented findings expressible. |
| **OUT-D** | OUT-4 | Cross-check section: name consistency, A-Number, address, signature date order. |
| **OUT-E** | OUT-5 | Bank Validation section when a G-1650 is present. |

**Gap found 2026-08-21 (N-001), not in Rob's catalog:** nothing in the output contract
specifies **ordering**. The table comes back in rule order (1-9), so passes lead and problems
trail. The frontend does not re-sort.

---

## F. What is NOT here

The most important line in this document. The following are **not rules**, and any finding
that rests on them is invented:

- Field / checkbox completeness (PS-107, proposed, flagged FP MAGNET)
- Page order or assembly (PS-104, proposed)
- Legibility or scan quality (PS-105, proposed)
- Barcode / form-type confirmation (PS-106, proposed)
- Signature freshness (PS-204, proposed)
- Fee coverage: one payment form per fee due (PS-402, proposed)
- G-28 coverage (PS-501, proposed — present today only as the NOTE-3 suppression)
- Form-set completeness by case type (PS-6xx, all proposed)
- Evidence by case type (PS-7xx, all proposed — this is Rob's item 3)
- **Closed world: report only defined rules (PS-001, tagged ⚠️ MISSING)**

PS-001 being missing is the whole of item 2. Demonstrated empirically on 2026-08-21: a single
blank I-130A produced five plausible findings mapping to no rule
(`runs/2026-08-21__i-130a__claude-session.html`).

---

## G. Editing workflow

The repo is **not** to be edited until Max meets Rob. To test a rule change:

1. Copy the live text: `node lib/extract-prompt.js > prompts/live-rules.txt`
2. Copy that to a variant, e.g. `prompts/v2-closed-world.txt`, and edit the variant.
3. Run against it: `node scan.js fixtures/x.pdf --prompt=prompts/v2-closed-world.txt`
   (or paste the variant into a Claude Project's custom instructions — same rules, no API cost)
4. The portal repo is never touched.
