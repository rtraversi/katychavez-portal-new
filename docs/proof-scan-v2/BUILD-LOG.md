# Proof Scan v2: build log

How v2 got here, in order. Every commit below is on `proof-scan-v2`. Test counts were
re-run by Claude after each batch, not just taken from the builder's report.

## Scoping (2026-09-04 to 2026-10-08)

Max scoped v2 with Codex (to 2026-09-25) and then Claude (from 2026-09-25), one decision at
a time, in `DECISIONS-MASTER-RECORD.md` (D-1 to D-102). A clickable design mockup was built
and reviewed with Max round by round (`lab-mockup/`), and every behaviour in it is a logged
decision. Key turns:

- **v1.2 deploy skipped; go straight to v2** (D-78).
- **Four stages:** Evidence Zero, Draft Review, Pre-flight, Physical Scan (D-52 to D-58).
- **A case is a folder** that names itself from the people (D-83, D-101); not linked to
  matters for now. **No PDFs are kept**, only the facts and the reports (D-84).
- **Full SSN** returned and stored encrypted, masked behind an eye toggle (D-80, D-97).
- **DACA Draft Review and Pre-flight mapped check by check** with Max (D-69 to D-73).
- **General case type** for everything without a checklist yet, one case card per person,
  and "the evidence must match the forms" as the biggest check (D-90 to D-100).
- **Possible issues** ships at launch, in the same AI request, never counted (D-86).
- **Staff sign-off** per stage (D-75); **rulebook** editable in the product (D-61, D-76).

## Batch 1: setup, security fix, database, rules (2026-10-07)

`7289a66` carry v1.2 hardening in · `3a46b37` merge main · `8a90307` 2000 security fix ·
`d01b365` 2001 core tables · `88974ea` 2002 rules · `64d66de` 2003 seed · `5eea9d0` tests.
750 to 781 tests.

## Batch 1b: real database test, encrypted SSN suggestions (2026-10-07)

`ef56945` encrypted SSN suggestions (D-97) · `49cb69e` `scripts/proof-scan-v2-dbcheck/`.
Migrations 001, 002, 003, 005, 1300 to 1303 and 2000 to 2003 applied cleanly to a local
Postgres 16.15 with a small Supabase shim; 30 checks passed, each also shown to fail when
the rule it guards is removed.

## Batch 2: server routes and the AI engine (2026-10-07)

`bd59103` PS-304 evidence matches the forms · `2329444` cases, people, record, SSN ·
`24d1978` Evidence Zero · `d92b4f5` stage runs · `07b2163` sign-off, rulebook, Possible
issues, email · `267300c` tests. 948 tests. Every AI answer is mocked.

## Batch 3: the screens (2026-10-08)

`97b4c1b` the v2 page next to the existing checker · `a0bee69` styles · `8129d91` tests
against the real routes · `c4c2191` the local preview (`npm run preview:proof-scan-v2`).
971 tests.

## Batch 4: a well-rounded General checker (2026-10-08)

`9e15f4a` full case cards and the new rules · `4613e09` server · `c995865` page ·
`1f222a3` preview data. New firm-wide rules: **PS-305** every fact shared by two forms about
the same person matches; **PS-306** foreign-language evidence needs an English translation
(counted). Expired evidence goes to Possible issues only. 995 tests, 32/32 database checks.

## Batch 5: this handoff (2026-10-08)

`docs/proof-scan-v2/`: this folder.

## v2.0.1: fixes from Max's first live review (2026-10-09)

Branch `proof-scan-v2.0.1`, from `module/forms-page-reorg` at `780c403`. No migration, no
new settings. 914 tests (904 before). Decisions D-103 to D-110 in `DECISIONS-MASTER-RECORD.md`.

- **D-103** Physical Scan is open without the evidence requirement (DACA too); Draft Review
  and Pre-flight still wait for it. Editing the record after approval no longer forces a
  re-approval before the next run.
- **D-104** A partly readable EAD counts as the EAD on file and fills the empty fields it read
  clearly; unreadable fields are skipped, no suggestions. A clear EAD is never replaced by a
  less clear copy.
- **D-105 / D-106** No "not on the case card yet" note; no "forms found" list.
- **D-107** G-28 EAD delivery: all boxes empty or home ticked is clear; office ticked is a
  gentle confirm, never counted.
- **D-108** Edition dates: the AI reference uses the edition the weekly USCIS check found
  (`form_editions.upstream_edition`, when `check_status` is current or stale), so a current
  form is no longer called out of date. The old checker is unchanged.
- **D-109** A problem's headline is the finding ("The I-765 signature page (page 6) is
  missing."), never the rule's own wording.
- **D-110** DACA: when the forms carry a full middle name the EAD does not show, and no
  other evidence shows it, a gentle confirm asks whether it was checked with the client.
- The Physical Scan report now has the same "Please confirm" block as Draft Review, so these
  confirms are visible there too (never counted).

## v2.0.2: false alarms, gentle confirms, privacy, USCIS editions (2026-10-15)

Branch `proof-scan-v2.0.2`, from `module/forms-page-reorg` at `79759a9`. Decisions D-111 to
D-128 (copied into `DECISIONS-MASTER-RECORD.md`). One migration, `2005_proof_scan_v2_0_2.sql`.
965 tests (914 before); `scripts/proof-scan-v2-dbcheck/run.sh` 39/39 (now also applies 1704 and 2005).
Every new user-facing string is a placeholder in `pages/proof-scan-v2/copy.js` (keys `v202.*`);
server sentences read the same file through `functions/api/_proof-scan-v2-copy.js`.

**Matching (A).** `_proof-scan-v2-common.js`:
- **D-111** `sameDate`: MM/DD/YY = MM/DD/YYYY both ways (month and day must agree, YY = last
  two digits). **Century rule, PROPOSED for Max:** a two-digit year is stored on the card only
  for an expiration (EAD, I-94, document), as 20YY; a past date (birth, marriage, entry) is
  never stored from a two-digit year and stays for staff, as before. Comparing never needs it.
- **D-117** `dateParts(value, order)`. **How a document's country is known, PROPOSED:** the
  model reports `issuing_country` (and `language`) per document; the server decides the order
  (`dateOrderFor`): US, US territories, the Philippines, Micronesia, Marshall Islands, Palau
  are month first; every other country day first; unknown country: not English = day first,
  else month first. A day-first document that prints a date only readable month first
  (09/30/1993) is read month first. Forms are always strictly month first, so a form that
  wrote a foreign date day first is caught even when the text matches.
- **D-118, D-126** country codes, names and nationality words (`_proof-scan-v2-places.js`,
  under `functions/`, never served); accents folded, not dropped; CBP port codes (a
  conservative list, **not checked against CBP's published list**: an unlisted code is
  compared as text, so it can only cause a false alarm); "(none)" / "N/A" on a form = a blank
  field (a card value against it is still reported as blank).
- **D-112** cause confirmed in the 79759a9 code: capitals alone never differ (`sameValue` and
  `sameName` both lower-case). The flag reproduces only when the record held "Doe" as a middle
  name and the forms carry "DOE DOUGLAS" as the last name. `compareNames` now reads the name
  as a whole: that split is a gentle confirm, never counted.
- **D-120** first + middle printed together = the same name.
- **Q-56** `city_of_birth` on the card (column added by 2005); compared only when the birth
  is known to be in the US. A place of marriage is not compared when known to be abroad.
- **D-116** a county on the evidence against a city on the forms: always a gentle confirm.
- **D-119 / Q-53** `sameEmployer`. **Typo vs short name, PROPOSED:** passes when the names are
  the same words once legal suffixes and filler are set aside (hyphens ignored), when one is
  the other's first words or its words in order, or an acronym. Anything else is counted:
  a short name only drops words, it never changes letters. An employer the evidence shows but
  the form leaves blank is counted.

**Gentle confirms (B), never counted:** last name or country not in caps (Q-48); two words in
a first-name field (Q-54); plus the name split, the county, the EAD ask and the edition notice.

**Rules (C).** Migration 2005 makes a new rule-set version per case type (copied from the
current one): PS-103 retired, PS-306 note. Blank or duplicate pages are observed by the model
(`page_problems`) and raised by the server as one Possible issue, key
`blank_or_duplicate_pages`. **Guard:** that key is reserved: "never suggest this reasoning"
is refused for it (route and page), the suppressions route refuses it, and the engine ignores
any suppression row with it. Passports are skipped by PS-306 in the engine (D-124).

**Labels (D).** 10 more document types (tax return, W-2, pay stub, naturalization certificate,
etc.); "other" uses the document's printed title. Every evidence finding gives file and page on
both sides.

**Stages (E).** No stage is locked (route and tracker). DACA Draft Review and Pre-flight ask
gently for the EAD when there is none in Evidence Zero or in the files, unless "no evidence"
was marked on purpose. Physical Scan unchanged.

**Email (F).** Last names in the subject and body, a link to the exact case
(`/portal?ps2case=<id>#proof-scan-v2`, the page opens it on load), one line per attention item
built from its kind, form, field, document type and role only (never a title or value). Clean
result: the "good to go" placeholder. Possible issues and confirms never included.

**Privacy (G).** Suggest-as-rule pre-fills the model's `general_rule` only if it holds no
digit and no word from the case's cards, forms or evidence; otherwise a default sentence. A
reasoning key keeps only its general words; a suppression's label is that key in words.

**Editions (H).** The weekly check keeps the last good edition and notices when a page cannot
be read (D-122); it reads each page's notices into accept / reject / only statements with
dates (`_uscis-editions.js`, tested on the 10-15 G-28, I-765, I-485, I-864 text), resolved on
the scan date; an edition mentioned in a way not understood is flagged (digest email, and a
gentle confirm on a run whose package has that form). `POST /api/proof-scan-v2-editions` +
"Check USCIS editions now" in the Rulebook (D-128), refused within a minute of the last run.

**Not done / for Max:** the century rule, the country rule, the employer rule and the CBP list
above are proposals awaiting confirmation. Light/dark visual check of the one new control (the
editions button) was not possible in this session (no browser); it uses kit classes and tokens only.

## What is NOT done

- Never run against the real Anthropic API, the real Supabase, or a real PDF.
- Migrations not applied anywhere. Not deployed.
- Placeholder wording throughout (`pages/proof-scan-v2/copy.js`); Max rewrites after launch.
- Removing the old checker waits until Max signs v2 off.

## v2.1: the AOS case type and the UI pass (branch `proof-scan-v2.1`, 2026-10-17)

Built on `proof-scan-v2.0.2` (`b8e3924`, PR #4, unmerged), for decisions D-129 to D-147 and
answers Q-59 to Q-81 as amended (copied into `DECISIONS-MASTER-RECORD.md`). Synthetic data
only. Local commit, not pushed. Migration `2006`, never applied anywhere.

**Tests:** 965 → 1019 passing (`npm test`). **Database checks:** 48/48 on a throwaway local
Postgres 16 (`scripts/proof-scan-v2-dbcheck/run.sh`, 2006 added to the chain).

### UI pass (all case types)
- **Type and greys (Max: "the font is too light and small"):** a `.ps2`-scoped ramp one step up
  and darker greys, both derived from the theme tokens (`css/portal.css`, end of file). No
  hard-coded colours; light, dark and every theme follow.
- **One design for all three stages (approved 10-16):** `pages/proof-scan-v2/results.js` is a new
  renderer for Draft Review, Pre-flight and Physical Scan. Physical Scan no longer uses
  `pages/proof-scan/report.js`, so the old checker's renderer is byte-for-byte unchanged (D-88).
- **One Needs attention list (D-135), server-side:** `functions/api/_proof-scan-v2-merge.js`.
  Case-card, reference, evidence and form-against-form differences become one `fact` item per
  person and fact (name parts one name, address parts one address), naming every source, with
  the findings kept under it (`parts`). Then two documents that disagree, failed checks, missing
  items, translations, corrections. `attention_count` and the email use the merged list.
  Result schema version 3; version-2 results still open, item by item as stored.
- **Issue cards (D-136, D-141):** title is what is wrong; "On the forms" / "On the {sources}";
  "Fix on" chips; a what-to-do line; checks show Expected, Where (duplicate page text dropped)
  and Why. Folded at first. 300 ms open, 240 ms close, the header's padding never changes, the
  last frame is held until closed, a timer finishes a throttled animation, no motion for reduced
  motion. The whole card is the hover target; centred SVG chevron. Clear sits beside the card's
  button, never inside it.
- **Clears (D-132, D-139, D-143):** table `proof_scan_clears` (case, stage, item key, hand or
  review, who, when; who and when never shown). `POST /api/proof-scan-v2-clear`. The server
  computes the result line, every count, the strip, each form's list and the Evidence Match
  rows from the clears (`functions/api/_proof-scan-v2-view.js`). Item keys are stable (a fact's
  key carries a hash of its values, never the values), so a re-run finding the same thing keeps
  the clear. "Mark this stage reviewed" clears every item; unmarking takes back only those.
- **Evidence Match (D-140, D-145):** one row per document inside "Whole package", which is the
  list's name in every stage. **Summary strip:** "N to fix · N to confirm · N possible issues",
  jumps that glow once, a bar that fills; all cleared turns green with "Mark this stage
  reviewed". **Also:** no "Included in the scan" (D-133), no severity label (D-142), confirms
  never in a form's list, a cleared confirm shows the check only, "General summary",
  "Suggestions only." (D-146), headlines no longer break at "Apt." (v2 only).

### AOS case type
- **Migration 2006:** `aos` case type; `aos_kind` on the case (required for AOS, locked with
  the case type); passport number and expiry on the card; `applies_when` on rules and package
  items; `missing_confirm` on package items; origin `answer_pattern`; `proof_scan_clears`;
  `proof_scan_answer_tally` (counts only: no case, run or person column); the AOS rule set v1
  (General's current firm-wide checks copied in SQL, then 49 AOS checks and 28 package items,
  generated from `functions/api/proof-scan-profiles/v2-aos-seed.json` by
  `scripts/proof-scan-v2-aos-seed.mjs`).
- **Server decisions** (`functions/api/_proof-scan-v2-aos.js`, wired in the engine): fees with
  the I-485 by age and guards 1, 2 and 4 (amounts live in the rule's Expected text, so staff
  edit them in the Rulebook; unreadable wording is not checked, never guessed) and the amended
  under-14 rule; G-1650 fine; money order a gentle confirm; cardholder anyone, a likely
  misspelling a gentle confirm; G-1450 email and phone (Q-79); the English/interpreter table
  (Q-67); "if needed" items read from the package (Q-72); visa and I-94 missing gentle (Q-74);
  relationship box against the kind as a reserved Possible issue (D-131); married names backed
  by a marriage certificate (Q-62); I-94 entry date and port gentle, passport number and expiry
  only (Q-61); two documents that disagree counted; the answer tally and Rulebook suggestions
  (D-138, `POST /api/proof-scan-v2-patterns`).
- **Model rules** for everything the model reads: names, boxes, form-number boxes (Q-80),
  signatures signed and dated (Q-81), the G-1450 signed by the cardholder (Q-78), income filled
  in only (Q-69), genocide, torture and terrorist activity No (D-137), page order inside forms
  (Q-71).
- **Page:** the kind picker at the start, the kind on the case header, multi-person cards,
  Evidence Zero with the AOS requirement, the Rulebook's "Suggested from answer patterns".

### Page and question numbers (item 9)
The portal's form maps are older editions (I-485 01/20/25, I-864 10/17/24), so the current
blank forms were read from uscis.gov (2026-10-16): I-485 09/18/26, I-864 and I-864A 08/24/26,
I-130 and I-130A 04/01/24, I-765 08/21/25, I-131 01/20/25, G-1450 02/06/26.
- **I-485 Question 61 is not confirmable.** Item 61 is "highest level of education" in both the
  09/18/26 and the 01/20/25 editions, not a yes/no question. The record says the number must be
  found before it becomes a rule, so it is not in the rule set. Open for Max.
- Torture 53.a and genocide 53.b are on page 17. The form never says "terrorism"; items 43.b to
  44 (page 16) are its terrorist-activity questions. That reading is Claude's, for Max to confirm.
- The current I-485 has no English/interpreter boxes in Part 10, so Q-67's box test applies to
  the I-130A and I-765; on the I-485 a filled interpreter section must be signed and dated.
- Moved from the sheet: I-765 address "questions 12-15" is now Part 2 items 5 to 7 (page 2); the
  I-130A language boxes are on page 3 (interpreter section page 4). Everything else on the
  sheet's pages matches the current editions.

### Choices made in the build (for Max)
- Clears count toward the result line for needs-attention and not-checked items (both keep a
  stage from being done); confirms and needs-info are cleared but never change the line. The
  strip's "to fix" is needs-attention only; its bar fills with every clearable item.
- A new run of a stage drops that stage's review clears with its sign-off (D-75: a fresh run
  needs a fresh review); hand clears stay.
- The answer tally counts Physical Scan runs only, so one case's Draft Review and Pre-flight do
  not count three times. Re-running the same Physical Scan does count again (nothing records
  which case answered, by design).
- The AOS kind is locked once the case starts, like the case type.
- AOS stages run whole-package only, like General.
- A Pre-flight correction only has to reach forms about the same person (v2.1, General too).
- The fee payer is matched against the person's card and every one of their forms, so a married
  name on the payment is still the person.
- G-1450 has no date beside the signature, so Q-81's "dated" is not asked of it.

### Preview
`PORT=8789 npm run preview:proof-scan-v2`. At start-up the four AOS cases of the mockup run
through the real engine (`test/fixtures/proof-scan-v2/aos-scenarios.mjs` answers the model):
SANTOS & VEGA (Evidence Zero, Draft Review, Pre-flight, Physical Scan), REYES (Miguel & Carmen),
NGUYEN & TRAN, OKAFOR & BELLO. Earlier answer counts are seeded so the Rulebook shows two
suggestions. Example buttons and click-to-add sample files in the banner.

### Not done
- I-485 Question 61 (above). Not run against the real AI; the AOS prompt and the new "aos"
  observations have only seen canned answers. Placeholder wording elsewhere stays as before.

## v2.1 follow-up (D-148, 2026-10-21)
D-148: the I-485 yes/no eligibility questions are left alone. The seeded rule AOS-485-SEC
(D-137: torture 53.a, genocide 53.b, terrorist activity 43.b to 44 "answered No") is withdrawn
(R-9): removed from `v2-aos-seed.json`, the generated block in `2006_proof_scan_v2_1.sql` and
the model's rule guidance. AOS rule count 49 -> 48. The answer tally (D-138) is unchanged: those
questions are still counted, never flagged.
