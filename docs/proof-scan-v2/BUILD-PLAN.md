# Proof Scan v2: build plan

**Status:** draft for Max's review, written 2026-10-06. Nothing here is built, pushed,
migrated, or deployed. This plan turns the v2 Lab (`ui-lab-v2/`, `/v2-lab/`) and
decisions D-1 to D-82 in `PROOF-SCAN.md` into real portal work.

**How to read it:** section 1 is what only you can decide. Section 2 is Rob's. Sections
3 to 6 are the build itself, in the order it would happen. Anything marked **[Claude]** is
my recommendation or inference, not a decision.

---

## 1. Your decisions, before any build starts

**Answered 2026-10-07:** 1.1 folder, not linked to matters for now (D-83). 1.2 no PDFs
kept, reports kept (D-84). 1.3 Possible issues on at launch, same AI request (D-86).
1.4 wording replaced after launch (D-87). Testing: v2 next to the old checker for all
staff until Max signs off (D-88). Still open: 1.5.

**1.1 Where a Proof Scan case lives.** v2 keeps a case open across four stages (Evidence
Zero, Draft Review, Pre-flight, Physical Scan), so it has to be saved somewhere and found
again.

- **A. Attached to an existing portal matter.** Staff open Proof Scan from the matter, or
  pick the matter when starting. Easy to find later; one Proof Scan case per matter.
- **B. Standalone.** Staff start a Proof Scan case with a client name. Works even when the
  client has no matter in the portal; found later by searching the name.

[Claude] I'd recommend **A, with B as a fallback** when there is no matter. Note this only
decides where the case is *saved*. The reference record still comes from the evidence,
never from the client card (D-79).

**1.2 How long Proof Scan keeps uploaded documents.** v2 stores EADs, intakes, drafts and
scanned packages. D-55 says Proof Scan keeps only the current copy and the firm's own
system keeps the archive. Open: when a case is finished (Physical Scan signed off), should
Proof Scan delete its copies after some time, or keep them? [Claude] Keeping the inputs is
also what makes a past result re-checkable (Q-31).

**1.3 Possible issues at launch.** Today it is a shell: the screens work, but nothing
generates real suggestions or saves Accept / Dismiss / Suggest as a future rule.

- **A. Launch with it on** (more build work, more to test).
- **B. Launch with it off**, turn it on in a second release.

[Claude] I'd recommend **B**. It keeps the first real test focused on whether the
official checks are right.

**1.4 Wording.** About 150 strings in `ui-lab-v2/copy.js` are my placeholders. Options:
write them before the build, or test with mine and replace them before launch.

**1.5 Two small leftovers from the Lab review.**
- Physical Scan repeats the client details already shown in the case card (that block is
  part of the approved 1.2 report, so it stays unless you name it).
- When a payment form leaves phone and email blank, each blank is its own attention item.
  Grouping them by field would change the attention count.

---

## 2. Rob's items (owner-gated, B-1)

- **Q-13 / Q-33:** which repo and branch deploy to Katy's portal, and whether this belongs
  in the client repo or the template. Nothing can ship until this is known.
- **Migrations:** v1.2's 1302 and 1303 are applied nowhere. v2 adds more. Rob applies them,
  dev first, then production.
- **Q-28, model:** the checker calls `claude-sonnet-4-6` today. Which model v2 should use.
- **API data terms:** whether the firm's Anthropic account keeps uploaded PDFs, and whether
  zero data retention is available (D-62 note). v2 sends EADs and full SSNs.
- **Q-30:** whether `notify_email` is set on the live portal (the old checker emails every
  scan unconditionally).
- **Q-32:** what a scan costs today. v2 makes more calls per case (one per stage, plus
  Evidence Zero reads).

---

## 3. Before the first line of code

**3.1 Sync the repo.** Done 2026-10-06 (`PROOF-SCAN-V2-SPECS.md` section A): GitHub's
`main` gained 5 commits since the v1.2 split, none touching Proof Scan. Terminal fetches, then branches v2
from the v1.2 work (`codex/proof-scan-production`, `51aa67f` plus `f9428ae`), not from the
old checker.

**3.2 Decide what happens to v1.2's uncommitted Batch 5.** [verified 2026-09-09] It holds
real hardening (client-role refusal, stricter validation, legacy-row safety). [Claude]
Commit it as the base, then change the parts v2 reverses on purpose (full SSN, D-80).

**3.3 Security check on existing tables.** [verified] `proof_scans` and
`proof_scan_config` use row security policies of `USING (true)`, and the portal's browser
code talks to Supabase directly (`js/supabase-client.js`). [unverified] whether a client
login can therefore read Proof Scan rows. v2 stores EAD images and full SSNs, so every v2
table must be **staff only**, checked against the portal's real roles, before any real
data goes in. **Checked 2026-10-06** (`PROOF-SCAN-V2-SPECS.md` section B): the problem is
real in the code and affects the live checker today, not just v2. Rob should fix it now.

---

## 4. The build, in batches

Each batch is one terminal prompt, reviewed by me before the next. Same rhythm as 1.2.

**Batch 1: Database.** New tables, staff-only, dev first:
- Proof Scan case folders (case type locked at start, D-77; not linked to matters, D-83)
- people on a case: one case card per person, with a role (D-94); DACA has one
- documents in the Evidence Zero workspace (type, read quality, staff type correction,
  replaced-by), files kept in R2 like the rest of the portal
- a reference record per person, and its suggested changes (never auto-applied, D-55)
- which person (or people) each evidence document belongs to (D-94)
- stage runs (stage, scope, result, rule-set version) and stage sign-offs (D-75)
- rules, rule versions, stage mapping, learned rules, suppressed reasoning (D-59 to D-61,
  D-76)
- full SSN shown masked until toggled (D-80); [Claude] stored encrypted, the way the
  portal already protects SSNs (AES-256-GCM)

**Batch 2: Rules become data.** Move the DACA profile from the JSON file in code into the
rules tables. Seed it with the 39 v1.2 checks, the Draft Review and Pre-flight mapping
(D-69 to D-73), the template I-765WS sentence (D-69), "check only if filled in" (D-70),
and the gentle English question at Draft Review only (D-70). Every run records the rule
version it used, so old results stay tied to old rules (D-60).

**Batch 3: Evidence Zero.** Upload a document, the AI identifies it and reads the case
facts (EAD: name, date of birth, A-Number, expiration, D-53). Clear values fill empty
fields; differences become suggestions (D-55); unreadable sources ask for review and
never create a discrepancy (D-54). The evidence requirement (D-91): DACA needs the EAD,
its details and the address; General needs at least one evidence document; or a
deliberate "no evidence for this case". Optional address parts appear only when a source has them (D-82).

**General case type (D-90 to D-95).** Seeded alongside DACA: the 7 firm-wide checks only,
all four stages, no expected-forms list, no evidence gate: staff can go straight to
Physical Scan with the whole package, evidence included. An AOS package is at most about
137 pages, which one request handles; the upload states its size limit (D-95).

**Batch 4: The review engine.** One engine for Draft Review, Pre-flight and Physical
Scan, driven by the stage mapping:
- new result states: needs info, please confirm, checked later, not checked here
- per-form address comparison (D-81), A-Number format never a finding (N-016)
- per-person name / A-Number / address checks; evidence matched to its owner (D-94)
- **evidence matches the forms**, the biggest general check (D-98): every document's facts
  against its owner's forms, one attention item per difference
- Pre-flight client corrections: marked-up pages vs corrected pages, handwriting treated
  as uncertain, not-fixed and missing-corrected-page count, fixed values become
  suggestions (D-68, D-72, D-73)
- the AI returns the full SSN (D-80)
- keeps v1.2's strict contract: unknown, duplicate or missing check IDs fail the scan
  (D-19, D-20); the AI reports observations only, the server decides everything else
  (D-18)

**Batch 5: The screens.** Port the Lab into `pages/proof-scan/`: start and locked case
type, the case card with tracker and summary, Evidence Zero, the three stages with the
1.2 drop zone, scan sweep and report, file lists, sign-off, SSN eye toggle, rulebook with
add and edit, optional email. The 1.2 report renderer is reused, not rewritten.

**Batch 6: Swap out the old checker.** Until Max signs v2 off, both run side by side for
all staff (D-88). After sign-off, the new page replaces the old HTML checker. Old
reports stay readable as plain text (D-42). The firm-wide custom-instructions box is
retired in favor of the rulebook. Email sends only the official stage result (D-61).

**Batch 7 (later, per decision 1.3): Possible issues for real.** Generate suggestions,
save Accept / Dismiss / Suggest as a future rule, firm-wide "never suggest again".

---

## 5. Testing, before Rob deploys

You run these in dev. Real client files never come to me (standing rule).

1. **The known-good DACA package** (N-010). Expected: only legitimate findings.
2. **The error-injected package** (N-020). Expected: it catches the case-specific errors
   the old checker missed.
3. **An EAD upload, clear and blurry.** Expected: clear fills the record, blurry asks for
   review.
4. **A real Pre-flight with handwritten markups.** This is the least proven part; the
   result tells us how far to trust handwriting reads.
5. **A two-person check:** a second staff member runs the same case, to see whether the
   screens make sense without us explaining them.

The existing test suite (750 tests at v1.2) is extended batch by batch; no batch merges
with failing tests.

---

## 6. Honest risks

- **Nothing has run on a real PDF**, v1.2 included (B-3). Every v2 result so far comes
  from sample data.
- **Handwriting.** Reading pen corrections is the weakest link. The design already treats
  it as uncertain, but we do not know the error rate yet.
- **Size and time limits.** v1.2 caps a PDF at 12 MB. Seven separate files plus an EAD
  may hit Cloudflare's request time limits; the build may need to process files one at a
  time.
- **Cost per case** goes up with one call per stage plus Evidence Zero reads (Q-32).
- **The live portal still runs the old checker** with the retired signature-date rule
  (R-1) until the swap ships.

---

*Source of truth for every decision referenced here: `PROOF-SCAN.md`. If this plan and
the master record disagree, the master record wins.*
