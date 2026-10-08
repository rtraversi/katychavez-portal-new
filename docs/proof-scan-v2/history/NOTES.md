# Proof Scan — Max's working notes

Running log for the week of 2026-08-21. Max writes, Claude logs verbatim with a date.
Notes are quoted exactly as written; anything Claude adds is marked **[verified]** or
**[Claude]** so the two never blur together.

---

## 2026-08-21

### N-001 — Status ordering is backwards

> "i think the current way it shows the status' is rly bad. the first thing we want to
> see is if there is a mistake. so why is the first thing a pass? lol"

**[verified]** Correct, and it is a genuine gap in the output contract, not a model quirk.

- The prompt's output spec (`proof-scan.js`, "Format your response as:") asks for
  "An HTML table: Status | Form/Document | Issue | Detail". It says **nothing** about
  ordering, severity, or putting problems first.
- So the model writes the table in the order it worked the rules: 1 through 9. Edition
  date and page count are rules 1 and 2, and they usually pass, so a clean package's
  problems land near the bottom.
- The frontend does not re-sort either. `pages/proof-scan/proof-scan.js:346-352`
  (`themeResultHtml`) only tags the first cell of each row with `ps-pass` / `ps-fail`
  for theme-aware coloring. It reads the order the model produced and renders it as-is.

**[Claude] This is not in Rob's catalog.** `PROOF-SCAN-RULES.md` §10 lists OUT-1 through
OUT-8 and none of them covers presentation order or severity ranking. OUT-8 proposes a
severity *field*, which is a prerequisite, but nothing says the report must lead with
problems. First note of the week and it already adds a row Rob does not have.

Candidate fix, cheap either way:
- **Prompt-side (today):** add to the output spec — "Order the table by severity: every
  NEEDS CORRECTION row first, then N/A, then PASS. A reviewer must see problems without
  scrolling."
- **Render-side (better, later):** once findings carry a severity (OUT-8) and a `rule_id`
  (OUT-6), we build the HTML ourselves and sorting stops being something we ask the model
  to remember.

Worth raising with Rob as an output-contract item, not a rule change.

---

### N-002 — Is the lab a true 1:1 of production?

> "is this a 1:1 (back end) recreation of the checker? i dont want to be testing a dud."

**[verified]** Answered in full in the session. Short version: the prompt and request
shape are exact; **two database-backed inputs are not, and both are unknowable without
DB access.** See the fidelity table in `RULES-LIVE.md` and the open question for Rob:

1. `form_editions` carries **32 forms** in production (seeded across the `1600-*`
   migrations) but the lab uses `FALLBACK_EDITIONS`, which has **15**.
2. `proof_scan_config.custom_instructions` is appended to production's prompt. Contents
   unknown. The lab sends none unless told to.

---

### N-003 — Payment forms: nobody checks whether the COUNT is right

> "agreed. but right now i am not sure if this is a per type of case situation that the
> checker actually makes sure that for example an AOS with the right context needs around
> 3-4 of the 1450s. but for something like with an AOS, this will be different. and idk if
> right now its checking whether or not it is the right amount."

**[verified] It is not checking. Nothing in the system checks it.** Rule 3 only says multiple
G-1450/G-1650 are "normal and expected (one per filing fee)" and must not be flagged as
duplicates. That is a **suppression**, not a count check. Zero payment forms and nine payment
forms are both accepted in silence.

**[Claude]** Max reached this independently, and Rob's handoff §4 already lists it as a
candidate gap: *"one payment form per filing fee actually due for the forms present. Today
multiple payment forms are merely tolerated; nothing checks that the count matches the
filings."* Two people found the same hole from opposite directions, which is the strongest
signal available that it is real. In Rob's catalog this is the PS-4xx family, which currently
contains only PS-401 (routing validation) — fee *coverage* has no PS number at all yet.

This is also the first concrete instance of N-009: the correct number of payment forms is a
function of case type and of which forms are in the package. It cannot be a global constant.

**Open questions for Max — this is firm knowledge, not code knowledge:**
1. Is the expected count driven by **forms filed** or by **applicants**? A family of four
   filing I-485s: one payment form per form, or one per person?
2. Does the firm ever cover **multiple fees with a single** payment form?
3. How do **fee waivers (I-912)** change it? A waived form presumably expects zero payment
   forms, which inverts the check rather than adjusting it.
4. Does the checker need the **current USCIS fee schedule** encoded, or only the expected count?
5. You said "for something like with an AOS, this will be different" — the sentence names AOS
   twice. Which second case type did you mean to contrast it against?

---

### N-004 — Feedback loop: grade past scans, let the grades write better rules

> "this is an AI, so in fact the checker can grow in crazy ways, i mean from every mistake it
> should've been learning, so also make a note to check how we can set up a feedback loop from
> all the past scans. grabbing all their inputs and setting up a system for me to grade it, so
> that claude can or you can draft new and more precisely rules, with judgement so they're not
> just flagging stuff crazily left and right."

Strong idea, and it is the mechanism handoff §9 is missing. But there is a hard blocker.

**⚠ [verified] BLOCKER — the past scans did not keep their inputs.**
`proof_scans` columns are exactly: `id, filename, result_html, status, tokens_used, scanned_by,
created_at` (`supabase/migrations/1300_proof_scan.sql`). There is **no `r2_key`, no file
pointer, no stored PDF**. Only the *filename string* survives. For every scan ever run we have
the verdict but not the package it was judging.

What that costs:
- You **cannot re-grade** a historical finding. "False positive" is unprovable without the
  document it was made against.
- You **cannot replay** the corpus against a revised prompt to measure improvement.
- One thing history IS still good for: mining `result_html` for the *shape* of findings,
  specifically which findings map to no rule. That quantifies the item-2 problem across real
  firm history and needs no input documents at all.

**[Claude] So the loop has to be built forward, not backward:**
1. **Start retaining the input package** (an `r2_key` column on `proof_scans` plus one upload
   call). Nothing else in this idea works without it, and every day it is not done is another
   day of ungradeable history.
2. Grading UI: each finding gets a verdict from Max.
3. **Every finding must carry a `rule_id`**, or a grade attaches to nothing. This makes N-004
   depend on handoff §2's structured output — grades against free-text findings are not
   analyzable.
4. With rule_id + grade + retained input, per-rule false-positive rate becomes a real number
   and rule edits become measurable instead of argued.

**Open questions for Max:**
1. Grading scale: binary correct/false-positive, or four-way (correct / false positive /
   missed / unclear)? The four-way costs nothing extra and "missed" is the only way to catch
   false *negatives*, which nobody is currently measuring at all.
2. Who grades? You only, or Katy and the paralegals too? Decides whether this needs real UI or
   can start as a spreadsheet.
3. Do we mine the existing `result_html` history for unmapped findings **now**? It is free,
   needs no input documents, and would give a real number for how often the scan invents rules.
4. "so that claude can or you can draft new and more precisely rules" — do you want the drafting
   to be a **suggestion queue you approve**, or should it write rule changes directly once a
   pattern passes some threshold?

---

### N-005 — **DECISION: delete rule 5 (signature date order)**

> "rule 5 is just flat out hallucinated and WRONG. rob and i made a note to delete that one bc
> signature date order is just not a thing for our firm."

**Logged 2026-08-21. Settled between Rob and Max, not a proposal.** Marked in `RULES-LIVE.md`.

**[Claude]** Worth keeping the context: rule 5 was one of three rules doing arithmetic in prose
(5, 7 and 9), which handoff §7.4 names as a false-positive generator. Deleting it removes one of
the three outright rather than re-engineering it, and takes a row out of every report. In Rob's
catalog this is **PS-202**, currently tagged ✅ implemented — the catalog will need it retired,
not just the prompt.

**Open question for Max:** delete outright, or keep it dormant/advisory so we can distinguish
"we removed it" from "it never fired"? Recommend outright — a dormant rule is exactly the kind
of thing that gets switched back on by accident a year from now. Also worth knowing for the
record: is it "not a thing" because the firm always signs same-day, or because USCIS does not
actually reject on it? The answer changes whether other firms using the template want it.

---

### N-006 — Rule 6 needs per-case role resolution, including the I-864A household member

> "about rule number six: great rule but it needs refinement. like what you mentioned, it needs
> to be per case. it needs to first identify who is the applicant/beneficiary and who is the
> petitioner/sponsor. as well as the family household member on the 864 and 864a."

Right diagnosis on the system's worst rule. Rule 6 is the **primary false-positive source** and
it currently knows only two roles, asserted in prose in the preamble. Max is naming a third that
the prompt has no concept of: the **household member** contributing income on the I-864A.

**[Claude]** The role set is at least four:
1. **Beneficiary / applicant** — the person seeking the benefit
2. **Petitioner / sponsor** — files on the beneficiary's behalf
3. **Joint sponsor** — files their own complete I-864 in which *they* are the Part 2 subject
4. **Household member** — I-864A, contributing income to the sponsor's household

**This is the same root cause the forms work hit in July.** Mapping the I-864 and I-130 produced
a written-up "per-case-context category" with three instances: the I-864 joint sponsor, I-130
items 61/62 (consular vs adjustment), and I-130 Part 2 items 18-19 (whose marriage is being
asked about). **The forms subsystem and the checker subsystem have now independently hit the same
wall: a static configuration cannot express a per-case role assignment.** That is the strongest
architectural argument to bring Rob, because one fix serves both halves of the product.

**Open questions for Max:**
1. Is the four-role list complete? Preparer and interpreter appear on the forms — confirm they
   are never name-consistency subjects.
2. **How should the checker learn the case type and roles — inferred from the forms present, or
   selected by the user at upload?** Handoff §5 asks this exact question and warns a wrong case
   type produces "a wholly wrong checklist." Inference is one more place to be wrong.
3. On an I-864A, should the household member's *address* be expected to match the sponsor's
   (they are certifying a shared household)? That would be a new rule, not a refinement of 6.

---

### N-007 — The evidence checker is in scope

> "another thing that i remembered is the evidence checker. we also have to include that."

Rob's item 3. Specified at a high level in handoff §5: build it from an explicit per-case-type
checklist table (`proof_scan_evidence_requirements`), **never** from the model's own knowledge
of immigration practice. The evidence pass then answers a **closed** question per checklist row
(present / absent / unclear) rather than the open-ended "what's missing," which §5 calls the
fastest way to reintroduce the false-positive problem.

**[Claude]** Sequencing note worth respecting: the handoff puts evidence **last**, because it
depends on the closed-world machinery from item 2 and on the platform work in §6 (evidence
packages are far larger PDFs than form packages, and the old Netlify timeout died on exactly
this case). It also lines up with N-009 — evidence requirements are inherently per case type, so
N-007 and N-009 are one architecture applied to two rule families.

**Open question for Max:** is "unclear" a failure? A blurry utility bill that might be a
joint-residence document probably should not be reported the same way as an absent one.

---

### N-008 — Overall read on the product

> "from what i can tell the checker was a half baked product. no offense to anyone, not to rob,
> or the tool itself, it just means that its going to be great once we refine this."

Recorded as Max's assessment. **[Claude]** Consistent with what the code shows: nine prose rules,
eight accumulated patches, zero tests, no closed world, three rules doing arithmetic by
inference, and a Netlify-to-Cloudflare port that stopped at "it runs." Rob's own handoff is
candid about most of this, so this reads as a shared assessment rather than a criticism.

---

### N-009 — **The architectural proposal: per-case-type rule sets, inherited from a base**

> "I THINK each case type SHOULD have its own rules. not from scratch, but adapted from the
> overall rules we already have. this is going to solve the ambiguity from the past rule."

**The biggest idea in the notes so far.** It resolves several open threads at once:
- **N-003** (payment form counts) is per case type
- **N-006** (role resolution for rule 6) is per case type
- **N-007** (evidence requirements) is per case type
- The forms-side "per-case-context category" from July is the same problem in another subsystem

**[Claude]** Proposed shape for discussion: a **base rule set** applying everywhere, plus a
**per-case-type overlay** that can narrow scope, set expected counts, fix the role map, and add
case-specific rules. Explicitly *not* a fork of the rules per case type, which would drift within
a month. Max's own framing — "not from scratch, but adapted from the overall rules we already
have" — is exactly inheritance, and it is the right instinct.

This depends on handoff §2's "rules as data" proposal (a `proof_scan_rules` table instead of
prose in a prompt string). Overlays are natural as data rows and impossible as one frozen
template literal.

**[verified] Case types present in the repo (likely partial):** advance_parole,
cancellation_of_removal, certificate_of_citizenship, green_card_renewal, inadmissibility_waiver,
parole_in_place, remove_conditions, temporary_protected_status, unlawful_presence_waiver, plus
sub-tabs family_based / employment_based / humanitarian. Adjustment of status, naturalization and
DACA are referenced throughout the prompt but did not surface in this grep, so the list needs
confirming against the Case Builder.

**Open questions for Max:**
1. Which case types matter **on day one** — all of them, or the four or five the firm actually
   files most? Building nine overlays before proving one is the classic way to stall.
2. **Inheritance model:** can a case type *disable* a base rule, or only narrow it and add? If it
   can disable, which layer wins on conflict?
3. Can one package span **two case types** at once, and if so what should happen?
4. Same question as N-006.2, and probably one decision serving both: is case type **selected at
   upload** or **inferred from the forms present**?

---

## Standing open questions for Rob

1. Dump of `form_editions` and the current `proof_scan_config.custom_instructions` — closes both
   fidelity gaps in N-002. Read-only, contains no client data.
2. Is `notify_email` currently set on Katy's portal? Determines the blast radius of a stray scan.
3. The firm's actual **proof checklist** as an artifact. The handoff's own named blocker for item 1.
4. Would he fund an API key for baseline measurement — and what do his existing Anthropic billing
   records say a real scan has actually cost to date?
5. Confirm production really deploys from `module/forms-page-reorg` rather than `main`.
6. **New, from N-004:** add an `r2_key` to `proof_scans` so scans start retaining their inputs.
   Every day this is not done is another day of ungradeable history.

---

## Notes still to come

Max has more. Paste them and they get logged here.

---

## 2026-08-28

Source: a real proof scan run on the portal against a DACA package the firm knows is good
(EAD approved). Run on production, so on the OLD prompt — none of today's fixes are deployed.

---

### N-010 — Ground truth established: the approved DACA package

> "the daca case are reviewing is 100% correct. we can establish it as the basis for truth.
> thankfully the only real failure was the edition dates. as of like a week ago the edition
> dates swapped so that has been a bit of a hassle but whatever. so that it did check for and
> it caught and i am glad it did."

**This is the first must-not-trip fixture the project has.** Handoff §4 requires one per rule and
there were none. Scoring rule for this package: the edition finding is correct; **every other
finding is a false positive by definition.**

**[Claude]** The edition catch is also the one rule that worked exactly as designed, on the week
USCIS actually moved. Worth remembering when the FP list below gets long.

---

### N-011 — Are there case-specific rules anywhere? **No. Verified.**

> "i want to know if apart from the rules on rules md there exists other rules like case specific
> rules. becuase we have checklists for like all case types and like, i want to know if this thing
> is catching those things from a specific file or if it was fed into the code or what did rob do
> lmao. if the answer is that ONLY these rules are the ones that checker is using then shit this
> checker is not up to speed and needs what i was suggesting."

**[verified] The nine prompt rules are the entire checker. There is nothing else.**

`functions/api/proof-scan.js` touches exactly three database tables:

| Table | What it supplies |
|---|---|
| `form_editions` | the edition/page reference list |
| `proof_scan_config` | one firm-wide free-text `custom_instructions` blob |
| `proof_scans` | writing the result, and rate limiting |

No case type. No matter. No checklist. The scan never learns what kind of case it is looking at.

**[verified] And the escape hatch cannot hold case rules either.** `proof_scan_config` is a
**singleton** — migration 1300 puts a unique index on `((true))`, so exactly one row exists for the
whole firm, with one `custom_instructions` text field. There is no column, row, or key where a
per-case-type rule could be written.

**[verified] Meanwhile the firm's checklists DO exist, already per case type.** Migration 400
creates `document_checklists`; migration 902 adds `case_types text[]` to it, where NULL means
universal and an array means it applies to those types only. **The checker has never read that
table.** The data Max is describing is sitting in the same database the scan connects to.

**[Claude]** So N-009 is not a nice-to-have. The per-case-type overlay Max proposed on 08-21 is
the missing half of a design that already exists on the documents side. The checklists are built;
nothing wired them to the checker.

---

### N-012 — The output is bloated, and staff will stop reading it

> "but like i noted on my notes prior, the way we are presenting the information IS THE PROBLEM in
> my opinion. because the rules are editable lol."

> "today you might have noticed that the problem i had with your outputs is also the same i iwll
> have with these outputs. its so much AI fluf, its annoying. rn your outputs are good because they
> are concise. and they still get the message accross. THAT is effective communication. so this is
> happening on the portal checker as well. it has so much text and staff has to lose so much time
> to know that something went wrong or well. and tbh, if that is the way its going to work i am sure
> staff will likely read only the fail or pass and move on without knowing what happened."

**Max's central claim: presentation is the bigger problem, because the rules are editable and the
presentation is not.** Escalates N-001 from "ordering is backwards" to "the whole report format is
wrong for its reader."

**[Claude]** The failure mode he names is the expensive one. A report nobody finishes reading is
worse than a short report that misses something, because it looks like coverage. Every FP below
adds length, so FP removal and brevity are the same project.

---

### N-013 — UI: show the current edition with a check, not a paragraph

> "current edition should show the current edition and a check mark to signify that it has passed
> meaning that is also the edition on the forms. this is a UI note."

---

### N-014 — Suppressions should not print at all

> "\"I-765WS is never listed on G-28 for DACA packages — not flagged. ✓\" i think this is something
> rob modified because last time it was flagging it as being necessary lol. but hey its better this
> way, but we dont care. it should just say pass 821 and 765 included. this is what i mean about
> bloating the text with fluf."

**[verified] Correction: Rob did not modify this recently.** The line has been in the prompt since
the original proof-scan commit, `616f57e`, 2026-06-24. It is not a new patch.

**[Claude]** The real finding stands and is broader than the one line: **a suppression rule is
announcing itself.** PS-203 and the petitioner-name exception will do the same thing. A rule whose
whole job is to stay quiet should produce no row.

---

### N-015 — FATAL, invented: signature date order

> "\"FAIL I-765 — Signature Date Order Applicant Signed After Attorney\" we discussed how stupid
> this made up rule was. which takes me to my next point. we shouldmake it so that it CANNOT INVENT
> RULES. it can propose them and have a section with its only relevant and fatal flags. bc this one,
> it claimed as fatal, and is just a hallucination."

**[verified] It fired because the fix is not deployed.** PS-202 was retired in commit `8602983`
today, on branch `module/proof-scan-rules`, unpushed. Production still runs it.

**[Claude]** Two separate problems in one row, worth keeping apart:
1. The rule existed and is now deleted. Solved.
2. **The model assigned it FATAL severity on its own.** Nothing in the prompt defines severities at
   all. It invented the weight as well as the finding. Deleting one rule does not fix that.

Max's proposed shape — findings must come from a fixed list, anything else goes in a separate
"proposed" section — is PS-001 plus OUT-6 in the catalog.

---

### N-016 — Hallucination: A-Number dashes on the EAD card

> "\"NOTE EAD Card (Supporting Document) A-Number Format on Card vs. Forms\". another hallucination.
> the only thing its flagging is that the EAD has dashes and forms dont. no shit sherlock. thats the
> way eads show their a number, but the forms never add the dasehs. and it wastes staff and attotney
> time."

**[verified] The prompt explicitly forbids this finding and the model made it anyway.** Rule 7 (was
rule 6 before today's renumber) reads: *"A-Numbers may appear as A-XXXXXXXXX or XXX-XXX-XXX — treat
these as equivalent formats and only flag if the underlying digits actually differ."*

**[Claude] This is the most important single data point in today's run.** The suppression was
already written, in plain language, in the rule itself — and it still produced the row. So the FP
problem cannot be fixed by wording rules more carefully. It needs an output contract that makes the
finding unexpressible: a closed `rule_id` list and a required citation. Prompt-side pleading has now
been measured and it does not hold.

---

### N-017 — G-1650 may not be worth checking at all

> "\"Bank / Payment Validation — No Form G-1650 (ACH bank draft) was found in this package. Two Form
> G-1450 (credit card authorization) forms are present. G-1450 is the credit card payment form — no
> routing number validation is required or applicable.\" we rarely use the 1650 since it gets denied
> more often. so maybe not check for this. i will talk to katy about this rule."

**Owner: Katy.** If the firm rarely files a G-1650, PS-401 (routing validation, and the largest
reference table baked into the prompt — 40 banks) may be dead weight.

**[Claude]** Note that the section printed a full paragraph to report that nothing needed checking.
Same shape as N-014: absence of a finding should produce no output.

---

### Next step Max named

> "after logging these notes and chatting about them i will introduce errors to the form and see
> which ones it catches. but later."

Deliberate error injection against the N-010 ground-truth package. That turns the fixture into a
must-trip set as well as a must-not-trip one.

---

### N-018 — A false positive triggers a full-scale alarm, including email

> "check screenshot, which is crazy how much of an alert it shows just bc of the attorney order
> signatures. thats an annoying error and makes our job worse by scaring us fakely."

The scan raised NEEDS CORRECTION and sent a notification email on a package the firm knows is good.
The trigger was PS-202, the deleted rule.

**[Claude] The severity machinery amplifies false positives.** Screenshot shows the status announced
three times before any content: an orange "Needs Correction" badge, the report title, then a
"⚠ OVERALL STATUS: NEEDS CORRECTION" line. Then an email goes out. One invented finding produces
four alarms.

Ties to N-015: the model chose FATAL on its own, and the pipeline honours that choice all the way
to the inbox. **Nothing downstream can tell a real failure from an invented one**, because status is
a single flag with no rule identity behind it. A closed rule list (PS-001) is what would let the
email say which rule fired, and let a retired rule stop mailing anyone.

---

### N-019 — Passes are printed first, and mostly should not be printed at all

> "why passes first? it shows all the passes and ngl thats kind of useless and it makes u read a lot
> of unnecessary text. this is why i wanted sections. BETTER UI!!!"

Third time this has surfaced, now from a real run: N-001 (ordering backwards), N-012 (bloat),
N-014/N-017 (suppressions announcing themselves), and now this.

**Max's ask is sections, not just sorting.** Problems in their own block, everything clean collapsed
or omitted.

---

### N-020 — **Error injection: it missed the fatal ones. Case types are the blocker.**

> "i riddled the scan with errors. and now that i am going to through i am seeing more issues."

> "it caught some of the issues i introduced but actually missed the fatal ones because, and this
> confirms my doubts, it does not know to check for specific case types. so that is the biggest thing
> it needs before i ever build it a new ui or improvements. the basis for each case type. first daca,
> then the others."

**The most important result the project has produced.** Max deliberately broke a known-good package
and measured what came back. The checker found the generic damage and missed the case-specific
failures.

**[Claude]** This is the same conclusion as N-011 arrived at from the opposite direction. N-011 read
the code and found no case-type input exists. N-020 ran the experiment and found the exact gap that
absence predicts. Code inspection and empirical test now agree, which is as strong as evidence gets
here.

It also reframes the whole backlog. Every rule in the current set is package-generic: editions, page
counts, signatures, name/A-Number/address consistency, routing numbers. **None of them can fail for a
case-type reason, so none of them can catch a case-type error.** More prompt tuning cannot reach
these misses — the input simply is not there.

**PRIORITY SET BY MAX, 2026-08-28:** build the per-case-type basis first. **DACA first**, then the
others. This outranks the UI work in N-012/N-013/N-019 and the rule cleanup, both of which Max
explicitly deferred behind it.

**[Claude]** Two things that already exist and should be checked before anything is designed:
1. `document_checklists` is already per case type (N-011). Find out what DACA rows it holds.
2. The lab has no DACA fixture. The six PDFs are I-130, I-130A, I-485, I-751, I-864, N-400. The
   ground-truth package from N-010 and this riddled copy are the two most valuable files in the
   project and neither is saved here yet.

**Open question for Katy/Rob, unavoidable now:** what is the authoritative DACA package definition —
the required forms, the required evidence, and the counts? N-011 shows the checker has nowhere to
read it from. Handoff open decision 1 (the firm's real checklist) is no longer one item among nine;
it is the thing blocking the top priority.

---

## 2026-08-31

### N-021 — **The DACA renewal checklist, from Max. The blocker is cleared.**

> "this should answer the first question. and the daca renewal actually needs:
> * two 1450s
> * a 1145
> * a g28 with only the 821d and 765 disclosed in part 3 1.b
> * the 821d
> * the 765
> * the 765 ws
> * and the ead card
>
> the file i shared is the fatal checklist. any of those items can get someone denied and should be
> included in the rules, rules for daca that is."

Source: `Copy of DACA Renewal checklist.docx`, the firm's working checklist. **Max signs off on this
himself; it was never waiting on Katy.** All items are FATAL by his instruction.

**[Claude] Two things about this document that change the design.**

**1. It is the antidote to the false-positive magnet.** `PROOF-SCAN-RULES.md` flags PS-107
(checkbox/field completeness) as the single rule most likely to reintroduce the FP problem, because
"is this field filled in correctly" is unbounded. Max's checklist is not unbounded. Every line names
a **form, a page, an item number, and the expected answer**:

- I-821D, page 1, item 5, Removal proceedings = NO
- I-821D, page 4, items 1-7, Criminal checkboxes = ALL NO
- I-765, page 3, item 27, Eligibility category = C33
- I-765, page 2, item 6, Physical address same = YES

That is a closed question with a known answer, which is the opposite of the open-ended judgment the
catalog warns about. **PS-107 is dangerous as a general rule and safe as a per-case-type rule** —
which is N-009's whole argument, arriving with a worked example.

**2. The checklist is a whole-workflow document; the scanner only sees the PDF.** It covers intake,
preparation, and mailing. A large part of it cannot be checked by reading the assembled package:

| Cannot be scanned | Why |
|---|---|
| $200 attorney fee, filing fees $520 & $85 | intake accounting, not in the PDF |
| 2 passport photos with name & A# on back | physical objects |
| Money order made out to US Dept. of Homeland Security | physical object |
| Photocopy of money order & photos | physical process |
| Prepare mailer, verify mailing address | process step |
| Scan all documents to Monday, retain copies | process step |

Encoding those as scan rules would produce permanent "not checked" noise on every DACA package, which
is the fluff problem from N-012 in a new costume. They stay in the checklist file, tagged as not
PDF-checkable, and are excluded from the report.

**Package composition rules now exist for the first time**, and this is the gap N-020 measured: two
G-1450s and one G-1145 is a countable fact nothing in the current checker looks at (N-003).

**Also new, and not in any existing rule:** the G-28 must disclose **only** I-821D and I-765 in Part 3
item 1.b. That is a *negative* condition — listing I-765WS there would be wrong. Related to the
long-standing suppression note about the I-765WS not appearing on the G-28, but this states the rule
properly instead of only suppressing a symptom.

**Still open:** the error-injection results from N-020. Which errors Max introduced, and which the
current checker caught.

---

### N-022 — UI direction from the first working draft (2026-08-31)

> "instead of doing it like that. have it be just the checker mark and have one g1450 display one
> amount and the other the other, i think its 85 and 560?? check first."

**[verified] It is $520 and $85, not 560.** Max's own checklist says so twice: "Filing Fees $520 &
$85" and "Money order $520 and $85 made out to US Dept. of Homeland Security". Recorded in
`daca-renewal.json` under `fees`, sourced to the document rather than to memory.

The two G-1450s are now two rows in the package table, told apart by the fee each carries. "G-1450
x2" cannot tell a reviewer *which* one is missing; "G-1450, $85 biometrics fee ✕" can.

> "7/8 but does not show which one is uncleared. i believe it should say so whomever is reviewing is
> aware." … "essentially the 1 missing i have no clue if it doesnt say"

**Fixed, and this corrects a bad call of mine.** I had removed problems from their form group to stop
them appearing twice, and left only a count. A count is not actionable. Each group now names its
outstanding checks on the closed row, so nothing has to be expanded to know what is wrong.

> "these are all critcal items. so have the entire thing from needs attention, to package, to checks,
> be inside a header saying critical items. for right now i dont know what other rules might go in the
> other sections we can call something else so lets just have this whole list be critical items and
> not invent anything else yet."

Everything sits under one **Critical items** band. No other severity tiers invented.

> "robs are fatal too as a general thing. and actually those are the ones we need to improve upon
> after setting the per case type rules. but first we have to get the ui right done until we can go
> ahead and fiddle w the rules."

All base rules set to fatal. **Order of work is settled: UI first, then rule refinement.**

> "the 1650 is honestly almost never included in dacas. and if it is we will be aware of it. so its
> best not to include on daca rules."

PS-401 removed from the base set. Answers the open question in N-017.

> "something else i did like on the past ui is a summary. so on the top it showed the relevant
> information about the client and the case. but it was doing it in such a ugh bloated and stupid way,
> and differently each time, that it made no sense."

**[Claude] The diagnosis is inconsistency, not the summary itself.** The old one was model-written
prose, so its shape changed every run and nothing could be scanned for. The new strip has fixed
fields in fixed order — Client, A-Number, EAD expires, Case — and prints an em-rule where a value is
unknown rather than reflowing.

> "also the ead is taken as the authoritative source of truth for the client's data."

**Recorded as a design fact, and it has teeth.** PS-301 and PS-302 currently check that names and
A-Numbers agree *with each other*, which passes cleanly when every form carries the same wrong value.
Judged against the EAD, they check correctness rather than internal agreement. Written into
`daca-renewal.json` as `source_of_truth`; the rules themselves are not rewritten yet.

> "it needs to check the amounts are right, that its signed and the credit card items are filled. im
> not sure if the checklist mentions that but if not then i am netionning it now. i feel like it would
> help if you took a look at the uscis templates so you had a better idea of what is in them."

The paper checklist has one G-1450 line: "Name, Email and Phone #". Everything else here is new.

**[verified] The repo already holds the G-1450's real field list** — `1600-g1450.sql`, the field map
Rob authored. No need to guess or download anything. It carries `AuthorizedPaymentAmt`,
`CreditCardNumber_1` through `_4`, `CreditCardTypeChBx[0-3]`, `ExpirationDate`, the `CCHolder*` name
and billing block, and `SignatureOfApplicant`. Five new rules written against those actual fields:
$520 authorised, $85 authorised, card number/type/expiry complete, cardholder details complete, and
signed.

**[Claude] Worth remembering as a method:** every form in the package already has an authored field
map in `supabase/migrations/1600-*.sql`. That is a better source for "what is on this form" than the
PDF itself, and better than either of us recalling it.

Renames: **Package → "Included in the scan"**, **Whole package → "Complete runthrough"**.

Still outstanding: the error-injection list from N-020, and Max's own wording for the pass lines.

---

### N-023 — Second UI pass: one row shape, and the red band comes off (2026-08-31)

> "the link you introduced on the critical items. i get it. but its way too harsh. and also the
> critical items header is too harsh too. im thinking its not necessary now. go back."

Both removed. **[Claude] Worth keeping the reason:** the red rule and the header were doing the job
the findings already do. When the frame shouts as loudly as the contents, nothing stands out — which
is the same failure as the old report's four simultaneous alarms in N-018, just in a nicer typeface.

> "i do like how the errors are displayed, but they should be instead on the same style as the
> correct items, but on highlighted and with colored font. like the idea is good, but its smaller and
> thus hard to ready."

> "i think yeah my idea about having the structure fixed on the stuff its checking and so if an item
> is missing or uncleared, have jsut that highlighted and with an x. this gives us a structure to
> become used to and accustomed and so makes the rool reliable."

**The most important instruction of this pass, and it reverses a call of mine.** I had given failures
their own larger row shape, which made the report's shape change with its contents. Max wants the
opposite: **every check always listed, in the same order, in the same row shape**, with a failing one
highlighted in place. Staff learn the shape once and then read by position.

Consequence worth stating: the report is now the same length whether a package is perfect or broken.
That is a feature. A reviewer who knows what "eight rows under I-765" looks like can spot a wrong one
without reading.

> "for forms that only have one page. its not necessary to write pg1, since its just one page lol."

**[verified]** Page counts come from `form_editions`: G-1450, G-1145 and I-765WS are one page each;
G-28 is four; I-821D and I-765 are seven. Single-page forms no longer print a page number.

> "No G-1450 authorising $85 was found. The biometrics fee is unpaid." — "it might be a correct check
> btu the phrasing is proably super off and thus not working."

Reworded to the pattern Max approved elsewhere — state what is wrong, then what it should be:
*"Only one G-1450 is in the package. A DACA renewal needs two, one for the $520 filing fee and one for
the $85 biometrics fee."*

> "I-765WS is listed in Part 3 item 1.b. Only I-821D and I-765 belong there." — "i like that. thats
> good wording."

**Recorded as the house pattern for a finding: the observed fact, then the expectation. Two short
sentences, no hedging, no rule language.**

> "so yes important, but lets make each notice retractable. and when clicked on have the exact details
> show." · "have not checked be expandable and retractable."

Both are collapsible now. A notice is one line; opening it shows what the checklist expected, where,
the rule ID and any note.

> "if a form is all good, have it turn green hehe, lets also make this a very satisfying tool to use."

A form group with everything cleared turns green and reads "all 10 cleared" rather than "10/10".

> "introduce errors to all so i can see how a fatally god awful form would look like lol."

Fixture 4, "Everything wrong": 19 findings, two missing documents, 17 needing attention. **Invented
for layout purposes only — these are not observed errors from a real scan**, and the fixture says so
in its own note.

---

### N-024 — Third UI pass, and the design is called done for now (2026-08-31)

> "also this design of the ui is right now perfect. so lets not take away from it unless i absolutely
> make a note to take something away from it."

**Standing instruction. The current report design is approved. Nothing comes out of it unless Max
says so by name.** Additions are fine; removals are not.

Changes in this pass, all Max's:

- **Pills, not boxes.** "i enjoy a pill more than a rounded ish corner box… and kind of favor pills
  instead of blocky blocks." Notices, checks and outstanding tags are pill-shaped; a notice squares
  off into a card only once it is opened.
- **Bold carries meaning now.** Max: "what i feel like is off, is how everything is in bold instead of
  clearly formatting something in bold and the rest of the text normally." The house pattern for a
  finding is two sentences — the observed fact, then the expectation — so the first is bold and the
  second is not. The line gets a shape instead of being uniformly loud.
- **Composition rows are one line.** "G-1450 $85. on the same line. underneath kinda breaks form."
- **"Included in the scan" turned down.** "it grabs my attention too much." Smaller type, lighter
  form names. It is context, not a finding.
- **Not-checked contrast fixed.** The grey fill was heavier than the muted text on it. Now a faint
  tint with full-strength text.
- **Client summary moved above the file name.**
- **Expand all / Collapse all** on the report header, driving every disclosure at once.

**[Claude] The bold note generalises past this screen.** Emphasis only reads as emphasis against
something unemphasised. The original production report failed the same way at a larger scale: when
every finding is reported at one weight and the model picks its own severities (N-015), nothing is
foreground. Same mistake in typography as in the rule model.

---

### N-025 — Animations, a frame bug, and the once-over (2026-08-31, wrap)

> "note that its a bit laggy but i get it since its an html."

**[Claude] Logged, and the second half of that is not quite right, so it is worth being precise.**
The lag is not because it is HTML. It is roughly forty elements each running their own entrance
animation, plus the disclosure transitions measuring layout on every open. **The same cost will
exist in production**, because production will render the same markup with the same stylesheet.

If it needs to come down later, in order of cost removed per unit of feel lost:
1. Drop the per-row stagger on `.psr-check` and keep the tick pop. Most of the cost, least of the charm.
2. Cap the entrance animation to the first visible group instead of every group.
3. Cache `scrollHeight` per fold rather than re-measuring on each toggle.

Not done now — Max approved the current feel, and slowing down to optimise a preview would be
premature. Recorded so the trade is a decision later and not a surprise.

Built this pass: smooth expand/collapse, progress bars that sweep to width, ticks that land with a
pop, and a verdict that counts up. The green sweep on a cleared form is **held** at Max's request,
and sticky attention counts were declined.

### The frame bug — the one thing here that would have shipped broken

Verifying the animations turned up a genuine defect. The bar width and the verdict count were both
being **written inside `requestAnimationFrame`**. On a hidden tab rAF never fires, so a package with
seventeen problems rendered as **"0 items need attention" with every bar empty**.

Found only because the preview pane happened to be backgrounded. A paralegal switching tabs while a
scan ran would have hit exactly the same thing, and the failure mode is the worst one available in
this product: a broken package that reads clean. Same shape as the truncated-report bug fixed in
`8602983` on 08-28 — an incomplete process presenting as a pass.

**Rule taken from it, and it should survive into production: the correct state is written
synchronously; an animation may only ever run backwards from a value that is already right.**

### Once-over findings

1. `collapsible()` was dead — every disclosure builds its own now. Removed, with its dead CSS.
2. **A regression against Max's standing instruction.** The EAD source-of-truth line disappeared from
   the report when the client summary moved above the file name. He never asked for it to go, and
   N-024 records that nothing comes out unless he names it. Restored.
3. All four fixtures render clean with no console errors.

### Where the work actually stands at wrap

**Done and approved:** the report design, the DACA renewal checklist as its rule source, base rules
inherited by every case type, and a lab that cannot drift from the portal page because it serves the
portal's own markup.

**Done but not shipped:** the two 08-28 commits on `module/proof-scan-rules` are local and unpushed.
Nothing is deployed. Rob deploys.

> "the rules are still not 100% but we made fantastic progress today."

**Correct, and worth stating plainly for whoever reads this next: none of this has run against a real
PDF.** Every fixture is hand-written. The checklist is faithful to the firm's document, and the UI is
approved, but no model has ever produced one of these structured results. The step that proves any of
it is a real scan composed through `compose.js`.

**Open, both on Max:**
- The error-injection list from N-020. Fixture 4 is invented for layout and says so in its own note.
- His own wording for the cleared lines. Every one of them is currently mine.

**Open, on Rob:** where the Sonnet 5 change went, and whether this work belongs in the client repo or
the template — unanswered since 2026-08-20.

---

## 2026-10-02

- **N-034 — Full SSN, 08:35 MST.** Max reversed the last-four-only rule; staff need to
  see the full SSN. Verbatim quote and the API finding are in `PROOF-SCAN.md` D-62.
- **N-035 — v2 Lab review, round 1.** Max reviewed Evidence Zero and the rulebook only;
  Pre-flight and later not reviewed yet. Verbatim on the A-Number: "a number prints with
  editable: A- dont allow to delete that just have it as a part of the format". On the
  address: "UNIT is not something we can put into a form." On the rulebook: "rulebook
  should allow for adding rules too btw." Flow quote in D-63. Fixed in the Lab by Claude
  directly. See D-63 to D-65.
- **N-036 — v2 Lab round 2.** Summary not sticky, full SSN in the Lab (D-62),
  expected evidence moved to Physical Scan (D-66), approval moves to stages (D-67).
- **N-037 — Pre-flight corrections check (D-68)** built in the Lab. Max asked for more
  colour and a better UI overall; logged as a note in `PROOF-SCAN.md`, not built yet.
- **N-038 — DACA Draft Review mapped item by item** (D-69, D-70). Lab stage map updated;
  "check if filled in" and "gentle confirm" states added to the Lab.
- **N-039 — Leftover questions closed:** Q-45 (type correction), Q-46 (light heads-up),
  Pre-flight scope (D-71 to D-73), stage gate (D-74).
- **N-040 — Lab UI pass.** 1.2 drop zone, scan sweep and report unseal reused across
  v2; uploads show as a file list; one case header (locked case type, tracker,
  summary); violet Possible issues; dates as MM/DD/YYYY; repeated text removed.
  Decisions D-75 to D-77.
- **N-041 — v2 accepted; v1.2 deploy skipped (D-78).** Claude's duplication worry was
  wrong and is recorded as such (D-79). SSN toggle added (D-80); address per form (D-81).
- **N-042 — Lab updated to D-83 to D-96 (2026-10-07).** Folder label, General case type
  (straight to any stage, firm-wide checks, AOS-style sample package), one case card per
  person with documents matched to owners, Physical Scan builds cards from the package and
  flags differences per person, size-limit note, old checker linked side by side.
- **N-044 — Batch 3 (screens) done, 2026-10-08.** 4 commits `97b4c1b`..`c4c2191`, 971 tests
  [verified]. Local preview of the real page: `npm run preview:proof-scan-v2` in the v2
  worktree. General checker widened (D-100).
- **N-045 — Lab updated to D-100 to D-102 (2026-10-08).** Full person cards, every shared
  fact checked across forms, evidence on the full fact list, forms-found list, expired
  passport as a Possible issue, translation rule (counted), self-naming folder, no General
  awareness note. One root cause is counted once.
- **N-046 — Batch 4 (General checker) done, 2026-10-08.** Commits `9e15f4a`..`1f222a3`, 995
  tests [verified], run.sh 32/32 [terminal's report]. New rules: PS-305 every shared fact
  matches across forms; PS-306 translation required (counted). Not pushed.

---

## 2026-09-25

Continuation with Codex. Product scoping only; no code, deployment, migration, or
external service action.

- **N-033 — v2 workflow continued and handed to Claude.** The canonical decisions
  are appended in `PROOF-SCAN.md` as D-52 through D-61. Evidence Zero, Draft Review,
  Pre-flight, Physical Scan, learning, rulebook, and notification boundaries are now
  scoped. `CLAUDE-TAKEOVER-2026-09-25.md` gives the required read order and exact
  next question. This note is intentionally a pointer rather than a duplicate.

---

## 2026-09-09

Session with Claude Desktop. Product scoping for **checker v2**, no code written.

Every decision and quote from this session is recorded in `PROOF-SCAN.md`, which was
created today as the master record. This entry is the pointer, not a second copy.

- **N-026 — The master record exists.** `PROOF-SCAN.md` now holds settled decisions,
  open questions, rejected ideas, what is built, and blockers. `NOTES.md` stays the
  chronological log. Where the two disagree, the master record wins.
- **N-027 — Version names, from Max.** The built final-package checker is **v1.2**.
  The staged oversight tool being scoped is **v2**.
- **N-028 — Friday's scoping was never written down.** The 2026-09-04 conversation
  with Codex lived only in a local session log. Recovered and folded into the master
  record as decisions D-7 through D-16.
- **N-029 — Prima is not connected to anything.** [verified] The only mentions in the
  portal are "Prima-style editing", a UX reference. The EAD wins for the fields it
  carries; Prima is firm tooling, not truth. See D-45 and D-46.
- **N-030 — Missing info is "needs info", not fatal.** Max's line: "not FATAL OMG WE
  ARE GONNA DIE." The stage decides when a gap escalates. See D-47 and D-50.
- **N-031 — Four stages, not five.** Max's own: intake and evidence, drafting,
  revision, final scan and printed package. See D-51.
- **N-032 — PS-104 shipped at fatal without review.** [verified] The catalog defines
  page order as internal to a form. The shipped profile carries only the bare title,
  and form-to-form order is specified nowhere. See Q-37 and Q-39.

Seven questions are pinned at the top of `PROOF-SCAN.md` for the next session.
