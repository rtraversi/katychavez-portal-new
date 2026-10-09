# Proof Scan — master record

**Owner of product decisions:** Max
**Repos:** this lab (`Anobe/proof-scan-lab`, private) is where we scope and prototype.
`katychavez-portal-new` is where the product ships.
**Started:** 2026-09-09, seeded from the 2026-09-04 session archive, the lab notes,
and a fresh read of both repos.

**Version naming (Max, 2026-09-09):**

- **Checker v1.2** — the structured DACA final-package checker. Four commits plus
  the uncommitted Batch 5 hardening. Built, tested, unshipped.
- **Checker v2** — the staged oversight tool being scoped now. Sections 2.2, 2.3
  and every open question in section 3 belong to v2.

[Claude] The older HTML checker still sitting on `main` is what v1.2 replaced. It
has no assigned number.

---

## How to use this file

This is **what is true right now**. It is the first thing a new session reads.

- `NOTES.md` stays the chronological log. What happened, in order, in Max's words.
- This file is the current state. Settled decisions, open questions, what exists.
  A reader should not need the log to understand where we are.

**Conventions, so nothing blurs:**

1. Every entry carries a date.
2. Max's words are quoted verbatim. Katy's words are marked as reported by Max.
   Anything written by Claude or Codex is labelled `[Claude]` or `[inferred]`.
3. Settled decisions are **append only**. To change one, add a reversal entry in
   section 4 and mark the original superseded. Never edit history in place.
4. Anything not personally checked is marked **[unverified]**.
5. No client PII. Firm process, fees, and workflow are fine. Real names,
   A-Numbers, addresses, and SSNs are not.

---

## 1. Status now

**As of 2026-09-25.**

| | |
|---|---|
| Portal branch | `codex/proof-scan-production` |
| Position | 14 commits ahead of `origin/main`, 2 behind |
| Pushed | No. Nothing in this workstream has left the laptop. |
| Test suite | 34 files, 750 tests, all passing (run 2026-09-09) |
| Migrations 1302 / 1303 | Written. Applied nowhere, dev or prod. |
| Real PDF run through the new path | Never happened |

Where things actually stand:

- The **structured DACA renewal checker is built and tested** on a local branch.
  Four commits, ending at `51aa67f`.
- A **Batch 5 hardening layer and the "Possible issues" frontend are uncommitted**
  in the portal working tree. Nothing there has moved since 2026-09-03.
- **What is live for Katy today is the old HTML checker**, from a July snapshot on
  `main`. The structured rewrite is entirely unshipped. [unverified: which branch
  actually deploys to Katy's portal is still Rob's open question, Q-13.]
- **v2 scoping has continued.** The core operating model is now settled through
  Evidence Zero, Draft Review, Pre-flight, Physical Scan, exploratory learning,
  the rulebook, and notifications (D-52 through D-61). The next work is to review
  the exact per-case rule and evidence catalogs without inventing requirements.

### Pinned for the next session (2026-09-25)

Ask one question at a time. Do not reopen settled workflow decisions or invent
immigration requirements.

1. With the v2 stage model settled, should Max and Claude first walk through the
   existing DACA v1.2 profile to confirm the exact Physical Scan form/evidence
   contract? Start from the firm's existing rule set; do not add legal requirements
   from model knowledge. (Q-44)
2. When Evidence Zero identifies a document type automatically, does staff need a
   way to correct that identification before it affects the reference record or the
   case-type evidence set? (Q-45)
3. Apart from expected final evidence, what should a missing reference value mean in
   Pre-flight versus Physical Scan? The Pre-flight answer for expected evidence is
   already a light notification; do not generalize beyond that without Max. (Q-46)

---

## 2. Settled decisions

### 2.1 What the product is

**D-1 — Proof Scan is becoming a staged oversight tool, not a bigger checklist.**
Date: 2026-09-04 archive. Source: Max and Katy.
The through line: **case type determines which rules exist; process stage
determines what is expected now and what may legitimately remain incomplete.**
An unfinished draft is not an incorrect draft.

**D-2 — Case type and process stage are two separate axes.**
Date: 2026-09-04. They are never collapsed into one selector.

**D-3 — "Incomplete for later" and "incorrect now" are different states.**
Date: 2026-09-04. A final-package checklist applied during intake would flag
signatures, financial answers, payment forms, and evidence that are not supposed
to exist yet, and would waste staff time.

**D-4 — The current final-package checker becomes one late stage, not the whole tool.**
Date: 2026-09-04.

**D-5 — The long-term goal is preventing staff mistakes, not verifying a static checklist.**
Date: 2026-08 meeting. Source: Katy, reported by Max.

**D-44 — Version names.**
Date: 2026-09-09. Source: Max. The built final-package checker is **v1.2**. The
staged oversight tool being scoped is **v2**. Use these names in every later
document, commit message, and question so the two never get confused.

### 2.2 Stage model (working, labels not final)

**D-6 — Five review moments, not five evidence categories.**
Date: 2026-09-04. Katy's "five different proofs" meant dividing long cases into
several review moments over time. It did **not** mean five legally required proof
types. Do not design around exactly five of anything.

**D-51 — The stages, in Max's own words.**
Date: 2026-09-09. Supersedes the tentative five-stage list below. Max, verbatim:

> "1. Intake and evidence — when we first start the case and the info and evidence
> to the checker
>
> 2. Drafting — when we start preparing the forms and when we most need to check
> the small amount of information with the evidence. at this point we already have
> very basic info, and with dacas most of it.
>
> 3. Revision — after we send it to client to revise and we write this information
> and start assembling for the final review
>
> 4. Final scan and printed package"

Four stages, not five. Two changes from the tentative list:

- Evidence is folded into intake rather than being its own middle stage. For a DACA
  renewal there is no long evidence-gathering period.
- Assembly moves into **Revision**. The package is assembled as the client's
  revisions are written in, so what gets printed is produced at the end of stage 3.
- Drafting is named as the stage where checking facts against evidence matters most.

[Claude] Two things to watch. Stage 4 now covers both the digital package and the
printed one, which leaves the approved print-ready reference without a home; see
Q-36. And AOS, where evidence really does arrive over months, may need stage 1 to
reopen rather than a separate evidence stage; that is Q-9.

---

**Superseded by D-51.** The earlier tentative list, kept for history:

1. Intake / source record
2. Draft review
3. Evidence / in progress
4. Final assembly / mailing
5. Final physical scan

### 2.3 Intake and the reference record

This is the section from the 2026-09-04 scoping session. It was never written to
any file until now.

**D-7 — Sources first. They become the established truth.**
Date: 2026-09-04. Max, verbatim:

> "First upload the intake and source documents. These become our established
> truth. The checker extracts the facts and they can edit and confirm the
> reference record before any drafted forms are checked."

**D-8 — Extracted facts are editable, and staff must confirm them.**
Date: 2026-09-04. An intake typo or an extraction error must not silently become
the truth every later form is judged against.

**D-9 — Confirming the record is not a gate.**
Date: 2026-09-04. Max, verbatim:

> "its not a block element they can select the kind of stage the case is, they
> might even choose review and do the check at the end. but these facts and items
> are held throughout if they are started to be filled in from the getgo."

Staff selects the stage. They may skip straight to a final review. If the record
was started early, it accumulates and stays available through every later stage.

**D-10 — Staff approves the record as a whole, but every field stays editable.**
Date: 2026-09-04. Max, verbatim:

> "they can approve the reference as a whole, if missing then no problem, checker
> jsut wont have a basis for truth but will still be able to check for
> consistency. but each item should be editable."

**D-11 — Missing values never block approval.**
Date: 2026-09-04. With no confirmed reference value the checker cannot judge
factual correctness, but it can still check consistency across the uploaded forms.

**D-12 — The DACA reference record holds these fields.**
Date: 2026-09-04.

- First, middle, last name
- Full address components
- Date of birth
- A-Number
- EAD expiration
- Phone
- Email
- SSN

**D-13 — SSN needs a pending state.**
Date: 2026-09-04. Max, verbatim:

> "add ssn to the list. but note that wont always be available at the start."

Not yet provided is a legitimate state, not an error.

**D-14 — DACA renewal is the real workflow, not initial DACA.**
Date: 2026-09-04. Max, verbatim:

> "For a typical DACA renewal (which is what we mainly do, not initial) we have
> only the EAD before drafting stage. We somemtimes have intake, sometimes we do
> not. But we do have their personal information. Most had signed up with us and
> the info lies on prima. But we always make sure to confirm this info before
> hand."

So: the EAD is normally the only source document before drafting. Intake is
optional and may not exist. Client information often already sits in Prima and is
always reconfirmed.

**D-15 — Storing the basic information properly is the point.**
Date: 2026-09-04. Max, verbatim:

> "That is why it is imperative for us to be able to store the basic info
> PROPERLY. I know checker rly cant check whether or not we wrote the address
> right or not on the checker itself, but at least it should be the same there or
> on the forms, and if they do not coincide we can check to see what was wrong,
> what we wrote on the intake stage, or on the drafted forms."

**D-45 — The EAD is authoritative. Prima is not.**
Date: 2026-09-09. Max, verbatim:

> "EAD is one of the chief authoritative evidence documents. if ead says ANA
> MARIA RIVER. It is ANA MARIA RIVER. Prima is our tool, not a truth teller."

For the fields the EAD carries, the EAD wins. No side-by-side choice is needed
and staff is not asked to arbitrate. Firm tooling never outranks a government
document.

[Claude] Two limits worth holding on to. The EAD carries only some of the record:
name, A-Number, and the expiration date. It carries no address, phone, email, or
SSN, so D-45 settles a subset of D-12. And "authoritative" here means authoritative
for what the document says, not proof that the underlying fact is current. A client
who moved still has an old address nowhere on the card.

**D-46 — Prima is not connected to anything.**
Date: 2026-09-09. [verified] The only mentions of Prima in the portal code are
"Prima-style editing", a UX reference for the in-app USCIS form editor. There is no
Prima import, feed, or API anywhere in either repo. A Prima value reaches the system
only because a person typed or pasted it. So the real conflict is never "EAD versus
Prima". It is **source document versus human-entered value**, and D-45 settles it.

**D-47 — Missing information is "needs info", not an error.**
Date: 2026-09-09. Max, verbatim:

> "sometimes we do not have that info, so we cannot proof for that, and usually on
> early stages we lack a lot of info. a checker that constatly freaks tf out
> because of that is not that useful. not on early stages like intake and
> drafting. so instead of checking for errors, it checks for OUR errors like
> inconsistencies which already it checks, and the checklist like for daca the
> checked marked items, etc, but the info that we lack that we have not obtained,
> that should be what checker says need info. not FATAL OMG WE ARE GONNA DIE. So
> yes we gotta make this guy smart, not just a robot checklist that goes crazy and
> cannot interpret."

Three separate things, and the checker must not blur them:

1. **Our errors.** Inconsistencies across the package. Already checked today.
2. **Checklist items.** The configured per-form checks, such as the DACA
   checkbox items. Already checked today.
3. **Information we have not obtained yet.** Reported as **needs info**. Never
   fatal at intake or drafting.

[Claude] This has a direct consequence for the v1.2 contract. Today there are three
statuses (`clear`, `needs_attention`, `not_checked`) and 38 of the 39 DACA checks are
severity `fatal`. `not_checked` currently means "could not be read", which is not the
same as "we do not have this yet". v2 needs a distinct state for the third category,
or D-47 cannot be expressed. Open: see Q-35.

**D-48 — The EAD is usually but not always available.**
Date: 2026-09-09. Max, verbatim:

> "yeah well ead sometimes its the only thing we have. sometimes we dont even have
> that, but thats rare. either way, ead helps us get the info we need."

So the reference record must work with no source document at all, not merely with
an incomplete one.

**D-49 — Intake facts stay editable, including anything carried over from forms.**
Date: 2026-09-09. Max, verbatim:

> "their info might be carried over via the forms so i guess we just have to ensure
> which documents are our evidence documents. so on the intake stage where we put
> in the ead and intake document, we have to be able to edit that info as well"

Restates and extends D-8 and D-10 at Max's request. Whatever the source, extracted
or carried over, every field on the intake screen is editable. It also raises a new
requirement: the system must know **which uploaded documents count as evidence**.
How that is designated is open, see Q-34.

**D-50 — The stage decides when "needs info" escalates.**
Date: 2026-09-09. Max, verbatim:

> "stages will help with that. intake and drafting, if the info is not yet
> available to us yes we need the info. but after that, after we get it, it becomes
> an actual issue."

Intake and drafting are the tolerant stages. Missing information there is reported
as **needs info** and nothing more. After those stages it is a real issue. Staff does
not mark items as required one by one; the stage does it.

[Claude] One ambiguity to settle while defining the stages: "after that, after we get
it" can mean either the gap escalates once the case leaves drafting, or it escalates
once the information has actually been obtained and something then disagrees with it.
Defining the stages should make this precise. Do not implement either reading until it
is.

**D-16 — A mismatch is a factual discrepancy, never a new rule.**
Date: 2026-09-04. Max, verbatim, correcting an earlier framing:

> "right but lets not have that be something that becomes a rule. its something we
> have to take in mind. because it will automatically flag it."

The comparison is expected behaviour. When the confirmed reference value and a
drafted value differ, the system shows the mismatch and both sources and lets
staff resolve it. It does not create a configurable or legal rule.

### 2.4 Report contract and language

**D-17 — Staff explicitly selects the scan profile.**
Date: Batch 0. The system never infers it from the filename, the forms found, or
the model's output.

**D-18 — Claude supplies observations only. Server code owns the result.**
Date: Batch 0. Approved rule IDs, package-item IDs, titles, severity, ordering,
suppression, report state, and every word of presentation language live in server
code.

**D-19 — Unknown, duplicate, and omitted identifiers fail closed.**
Date: Batch 1. Every expected applicable rule and package item must come back
exactly once.

**D-20 — A missing observation is never an automatic clear.**
Date: Batch 1.

**D-21 — A missing form is one issue, not a wall of duplicates.**
Date: Batch 1. Checks that depend on the missing form stay `not_checked`
internally and are suppressed from the report.

**D-22 — An independently unreadable check stays visible under "Not checked".**
Date: Batch 1.

**D-23 — There is no overall PASS verdict. Three states only.**
Date: Batch 0. Approved language, exactly:

- `N items need attention`
- `Review incomplete`
- `No issues found`

**D-24 — "No issues found" is not filing approval.**
Date: Batch 0. Staff review is still required, and the report says so in every
state.

**D-25 — Problems come first.**
Date: 2026-08-21, lab note N-001. The old prompt emitted rules in numeric order,
so passes led the report. Fixed by composing the report ourselves.

**D-26 — Suppressed checks do not print at all.**
Date: 2026-08-28, lab note N-014. Printing them was the same fluff problem in a
different costume.

**D-27 — The report design is approved and called done for now.**
Date: 2026-08-31, lab notes N-022 through N-025. One row shape for every check,
grouped by form, no red band, pills, and expand all.

### 2.5 Rules and the DACA profile

**D-28 — DACA renewal is the first configured profile.**
Date: Batch 0. Profile id `daca_renewal`, version 1, mapped to the portal case
type `daca`.

**D-29 — The firm's own DACA renewal checklist is the rule source.**
Date: 2026-08-31, lab note N-021. Source document: `Copy of DACA Renewal
checklist.docx`. Max signed off himself; it was never waiting on Katy. Max,
verbatim:

> "the file i shared is the fatal checklist. any of those items can get someone
> denied and should be included in the rules, rules for daca that is."

**D-30 — The expected package is eight items.**
Date: 2026-08-31. Max, verbatim:

> "the daca renewal actually needs: two 1450s, a 1145, a g28 with only the 821d
> and 765 disclosed in part 3 1.b, the 821d, the 765, the 765 ws, and the ead
> card"

As configured: two G-1450s (one for $520, one for $85), G-1145, G-28, I-821D,
I-765, I-765WS, and a front-and-back enlarged colour copy of the EAD card.

**D-31 — The G-28 rule is a negative condition.**
Date: 2026-08-31. Part 3 item 1.b must disclose **only** I-821D and I-765.
Listing the I-765WS there is wrong. This states the rule properly rather than
suppressing the symptom, which is what the old prompt did.

**D-32 — Checkbox completeness is safe per case type, dangerous as a general rule.**
Date: 2026-08-31, lab note N-021. [Claude] Max's checklist names a form, a page,
an item number, and the expected answer, which is a closed question. The same
idea written as a universal rule is unbounded and reintroduces false positives.

**D-33 — Physical and process steps are not scan rules.**
Date: 2026-08-31. Deliberately excluded because they would produce permanent
"not checked" noise on every package:

- $200 attorney fee and the $520 / $85 filing fees (intake accounting)
- Two passport photos with name and A-Number on the back (physical)
- Money order to US Dept. of Homeland Security (physical)
- Photocopies of the money order and photos (process)
- Preparing the mailer and verifying the mailing address (process)
- Scanning documents to Monday and retaining copies (process)

They stay in the checklist document, tagged as not PDF-checkable.

**D-34 — On USCIS forms, check the edition date, not the printed expiration date.**
Date: 2026-08 meeting. Source: Katy, reported by Max.
This is about form editions only. It does **not** mean ignoring meaningful
expiration dates on source documents. EAD expiration is a client fact and matters.

### 2.6 Exploratory "Possible issues"

**D-35 — The boundary.**
Date: 2026-09-04.

> The checklist checks what the firm already knows to ask. Exploratory review
> looks for what the firm may have forgotten to ask.

**D-36 — Exploratory findings are powerless.**
Date: 2026-09-04. They must not change the attention count, the report state, any
configured severity, the history summary, the notification email, or whether the
checklist says `No issues found`.

**D-37 — A suggestion must say four things.**
Date: 2026-09-04. What was noticed, where its evidence appears, why it might
matter, and what makes it uncertain. Freedom to investigate is not freedom to
invent legal requirements.

**D-38 — Accepting is not creating a rule.**
Date: 2026-09-04. **Accept** means this is a concern in this package. **Suggest as
a future rule** is a separate deliberate action taken afterward, and actual rule
creation still needs review and scope.

**D-39 — The UI is approved.**
Date: 2026-08-31 lab iterations, confirmed 2026-09-04. Heading `Possible issues:
N`, collapsed by default, compact rows aligned with the report, placed below
"Not checked", evidence behind a text link, dismissal choices only on open, muted
blue that does not borrow red, amber, or green status meaning.

### 2.7 v2 continuation — Evidence Zero through Physical Scan

This section records the 2026-09-25 continuation with Codex. It supersedes the
stage labels and several still-open workflow questions from the 2026-09-09 record.
It does not authorise implementation.

**D-52 — v2 has four named stages.**
Date: 2026-09-25. Source: Max. Supersedes D-51's labels and stage shape.

1. **Evidence Zero** — a persistent document and fact workspace.
2. **Draft Review** — review draft forms that are ready.
3. **Pre-flight** — optional proofing after signed documents and corrections, before
   physical preparation.
4. **Physical Scan** — the actual final-package check of the printed/prepared
   package.

Max's wording: "Stage 0 should be called evidence zero. sounds cool." The stage
names are now product language, not a tentative suggestion.

**D-53 — Evidence Zero is persistent and quiet.**
Date: 2026-09-25. Source: Max.

Evidence Zero is available throughout a case, not just at opening. This matters
especially for AOS, where evidence can arrive after drafting. Staff can add a
document at any time; the system identifies what it is, stores it in the Proof Scan
workspace, and summarizes the facts relevant to that document and case. It is not a
check stage: it has no official attention count or error language.

For an EAD, the useful summary is the name, date of birth, A-Number, and expiration
date. Do not substitute a generic document summary for case-relevant facts.

**D-54 — Primary evidence is authoritative only when it can be read reliably.**
Date: 2026-09-25. Source: Max.

EADs, vital records, IDs, and similar primary evidence are the source of truth for
the facts they carry. They outrank human-entered values and the drafting system.
But a poor, damaged, tainted, torn, incomplete, or otherwise unreadable source must
not manufacture a false discrepancy because OCR guessed wrong. In that condition,
the tool asks for review of the source rather than asserting that the form is wrong.

The model never resolves a conflict or overwrites a confirmed reference value on its
own. A clear conflict is a factual discrepancy for staff review, not a new
checklist/legal rule.

**D-55 — The reference record remains human-controlled.**
Date: 2026-09-25. Source: Max.

Staff may update the editable reference record whenever needed. When later evidence
conflicts with it, the new value is proposed for review and never overwrites the
record automatically. If a newer EAD, ID, or vital record replaces an older one,
Proof Scan replaces the older document in its own workspace; the firm's existing
record system owns any long-term document archive.

Evidence Zero also establishes the expected evidence for the eventual final package,
using the case-type reference rather than staff manually marking every stored document
as final-package material. Example: a DACA final package expects the EAD front and
back. The exact evidence catalog for each case type remains future rule work.

**D-56 — Entry and scope are explicit.**
Date: 2026-09-25. Source: Max.

Every use begins with **case type**, then **stage**. Evidence Zero opens the
document/fact workspace. The other stages open an upload and review workflow.
Staff may enter at any stage; a confirmed reference record is useful but never a
gate.

Draft Review and Pre-flight each have two explicit scopes:

- **Individual review** evaluates the selected form/document against the reference
  record and applicable checks. It ignores the rest of the package.
- **Whole review** expects the complete form set for that case type and selected
  stage. A missing required form is one item needing attention in Draft Review.

For a whole Draft Review, staff may provide one PDF containing all forms or separate
form files. The checker identifies and groups forms from their printed form names and
page numbering; staff should not have to label each one in the normal path.

**D-57 — The stage activates the appropriate portion of the case-type rule set.**
Date: 2026-09-25. Source: Max.

The final case-type catalog remains intact. The selected stage determines which
checks are active because their inputs should exist now, which are pending for later,
and which are not applicable. Staff does not manage those states one item at a time.
This preserves the distinction between an incorrect value now and information that is
legitimately not ready yet.

In Pre-flight, staff may review an individual form/document or the currently prepared
package; do not assume a merged PDF. Expected final evidence absent from a whole
Pre-flight review is a light notification, not an attention item. Do not extrapolate
that answer to every kind of missing information without Max's direction.

**D-58 — Physical Scan is the full v1.2-style final checker.**
Date: 2026-09-25. Source: Max.

Physical Scan is not a small generic page-integrity check. It is the actual final
check intended from the beginning: the complete case-type final rule set, all
configured evidence expectations, consistency checks, and the learning/oversight
layer. v1.2 is the model for this stage, not a feature being replaced by it.

At Physical Scan, missing required forms or expected evidence is an item needing
attention and is a major warning. The reference is the case-type package definition;
staff should not have to approve a unique print-ready PDF or manually create a
package baseline for ordinary cases.

Only within-document page order is a check: page 3 before page 2 of the I-821D, or
pages interleaved into another form. Do not enforce the firm's preferred order between
otherwise valid documents (for example, payment forms before G-1145 before G-28);
that is workflow habit, not a Proof Scan requirement.

**D-59 — Possible issues are the one home for learning.**
Date: 2026-09-25. Source: Max.

New model ideas and ideas shaped by previous staff decisions appear in the existing
separate **Possible issues** section. They never change the official attention count,
report state, or email. The allowed staff actions are **Accept**, **Dismiss**, and,
after acceptance, **Suggest as a future rule**.

"Never suggest this reasoning again" is a firm-wide, all-case-types suppression for
that exact reasoning pattern. Any Proof Scan user, including paralegals and attorneys,
may make it. The signature-date-order reasoning is the named example that must not
return.

**D-60 — Learned rules are immediate but human-authored.**
Date: 2026-09-25. Source: Max. Supersedes the final approval-queue implication in
D-38; acceptance remains separate from rule creation.

The model may recommend a clear scope for a learned rule: case-type-specific or
firm-wide. Staff may edit the proposed wording and scope before creation. When they
choose **Suggest as a future rule**, it becomes an official editable rule immediately;
there is no separate approval queue. Staff can revise it later in the rulebook.

The model cannot create a rule without this staff action. A new rule affects future
scans only. Historical results remain tied to the rule set that existed when they
ran.

**D-61 — The rulebook and email are intentionally simple.**
Date: 2026-09-25. Source: Max.

The rulebook must be an organized in-product interface; staff must not need to edit
code or a Markdown file. It separates firm-wide rules from case-type-specific rules
and shows each rule's scope and origin. It does not need a visible change-history
log.

Email is always optional. When enabled, it contains only the official stage result
and a link to the report. Possible issues never generate email.

### 2.8 Continuation protocol for Claude

Date: 2026-09-25. Source: Max's request for a complete Claude handoff.

1. Read this file completely, then `NOTES.md`, `RULES-LIVE.md`, and the portal
   build records listed in section 8 before proposing work.
2. Treat this file as the master record. The `PROOF-SCAN-*.md` files in the portal
   repository are historical unless this file expressly says otherwise.
3. Continue product scoping one focused question at a time. Distinguish Max's
   decisions, brainstorming, assistant inference, and unverified implementation
   claims. Do not resurrect a settled question.
4. Do not invent immigration requirements, evidence categories, or rule severities.
   Per-case evidence and rules come from the firm, not model knowledge.
5. Discussion only unless Max explicitly authorizes implementation. Do not push,
   deploy, apply migrations, or interfere with another active implementation session.
6. Record future settled decisions append-only in this master file and add a concise
   chronological pointer to `NOTES.md`. Never rewrite prior decisions; add a
   superseding entry when necessary.

### 2.9 Security and privacy

**D-40 — Full SSNs are forbidden.** Only a nullable `ssn_last4` may be handled or
shown. Date: Batch 0. **Superseded by D-62 (2026-10-02).**

**D-41 — Model output is never rendered as HTML.** Structured results render
through created DOM elements and text nodes. Date: Batch 3.

**D-42 — Legacy stored HTML is displayed as literal plain text.** Date: Batch 5.
Deliberate tradeoff: readability is given up so hostile stored markup is never
parsed, executed, or allowed to fetch anything.

**D-43 — History and email derive from the same validated structured result.**
Date: Batch 4. Notification is eligible only after storage succeeds.

**D-62 — Staff see the full SSN.** Date: 2026-10-02 08:35 MST. Source: Max.
Supersedes D-40 and answers Q-47. Max, verbatim:

> "we already get the reports w the ssn tho. thats fine. we need to see it. i can bring
> it up to rob, but we are already providing extremely personal info in our own records
> bc we are the ones that manage it and the api should in fact NOT be sending any info
> back to anthropic and if it is i suggest u come clean now. otherwise right it down."

Max will raise it with Rob. [verified 2026-10-02] Both the live checker (`origin/main`)
and v1.2 send the **entire PDF** to the Anthropic API on every scan, SSN included. That
is how the model reads the package; the four-digit limit only ever governed what came
back out. [unverified] Anthropic's retention and training terms for the firm's API
account: Rob to confirm against the account's agreement.

**D-63 — Case type, then Evidence Zero, then the stages.** Date: 2026-10-02. Source:
Max, from the v2 Lab review. Narrows D-56's "enter at any stage". Max, verbatim:

> "summary from evidence zero should always be present up at the top. it should be
> apparent so that it can be useful. instead of automatically being able to start the
> multi stages. have the user first select case type. then reveal evidence zero, and
> then after the info is in the summary is up at the top now and the multi stage is
> now ready to begin."

[Claude] Built in the Lab as: the stage picker appears once the reference record is
approved, and an empty record can still be approved (D-11). So it is one click, not a
data requirement. Max to confirm that reading.

**D-64 — Reference-record format follows the USCIS form.** Date: 2026-10-02. Source:
Max. The A-Number's "A-" is fixed format, not deletable text. Address has no "Unit"
field; it follows G-28 Part 3 item 12: street number and name, Apt./Ste./Flr. plus
number, city or town, state, ZIP code (verified against fieldmap migration 1514).
[Claude] The G-28's foreign-address fields (province, postal code, country) are left
out of the Lab for now.

**D-65 — Staff can add rules directly in the rulebook.** Date: 2026-10-02. Source: Max.
Not only through "Suggest as a future rule" (D-60).

**D-66 — Expected final evidence is shown at Physical Scan, not in Evidence Zero.**
Date: 2026-10-02. Source: Max. Supersedes the display part of D-55. Max, verbatim:
"i feel like that should be something we can disclose on the final scan not here."

**D-67 — Approving the record moves staff to the stage choice.** Date: 2026-10-02.
Source: Max. Not a silent reveal. Max, verbatim: "when the evidence has been approved
it should take u up or at least change page for the multi stage". The summary sits at
the top but is not sticky: "by stuck i didnt mean actually frozen up at the top. just
present okay."

**D-68 — Pre-flight can check client corrections.** Date: 2026-10-02. Source: Max.
Optional. Staff add the client's marked-up pages and the corrected pages; the checker
says whether each markup was fixed. Max, verbatim: "on pre-flight lets implement a way
to place the corrected pages and the marked down pages... that sounds like a good check.
still optional, and useful to check we did fix, again with a grain of rice since they
write with a pen so ocr can get it wrong. and preflight can also introduce the
corrected info for evidence zero to get updated yeah?"
[Claude] Built in the Lab: an unreadable markup asks for a look, never says "wrong".
Fixed corrections are **proposed** to the reference record (D-55), never written.
Max, 2026-10-02: "yeah count not fixed as attention". Only "Not fixed" counts; "Check"
and "Unreadable" do not.

**D-69 — DACA Draft Review: what waits and what is checked.** Date: 2026-10-02.
Source: Max. Partly answers Q-44 (stage mapping).
- Signatures wait for Pre-flight. Already settled with Codex 2026-09-25 as the D-57
  example ("signed final package").
- G-1450 card details and cardholder details wait. Max: "wait, they get that back to us
  on pre flight".
- Page order **is** checked, within a form only. Max: "maybe just form page order. like
  that the doc isnt 1, 3, 2, 4. kind of stuff... yeah?"
- I-765WS at Draft Review checks only the firm's template explanation. Max: "for this on
  draft we only ever have our template explanation. "I have to work to pay for my
  living expenses." just check that. that there is no typo and its exactly like that or
  at least a similar version without typos."
Still open: the rest of Draft Review, and all of Pre-flight.

**D-70 — DACA Draft Review, item by item.** Date: 2026-10-02. Source: Max, walking the
DACA checklist. Answers the Draft Review half of Q-44. Max's reason for the walkthrough:
"sometimes we dont have intake so we have no idea if they want the ead sent to them or
the office."
- **Checked at Draft Review:** edition dates, page counts, blank/duplicate pages, name,
  A-Number and address consistency; G-28 Part 3 1.b and applicant checkbox; I-821D
  renewal checkbox and expiry, name, mailing address, removal proceedings NO, continuous
  residence YES, date of birth, criminal questions all NO, English; I-765 renewal
  checkbox, name, physical address YES, questions 12 to 14, date of birth, item 25
  "DACA", C33, English; G-1450 name/email/phone and the $520 and $85 amounts; G-1145
  name/email/phone. Plus D-69 (page order, I-765WS template sentence).
- **Checked only if filled in, blank = needs info:** G-28 EAD sent to home or office.
- **Waits for Pre-flight:** signatures, G-1450 card and cardholder details, I-821D
  departures. Max on departures: "checker wont rly have idea of this so its something
  itll wait on preflight".
- **English questions (I-821D and I-765):** Max: "if marked no it shouldn't question just
  bring it up gently if it was intended or not." Not an error, not counted.
  [Claude] Said during the Draft Review walkthrough. Whether Pre-flight and Physical
  Scan treat a NO the same gentle way is not confirmed; v1.2 has it as fatal.
  **Answered 2026-10-02.** Max: "nah just another check no more gentle." Gentle at Draft
  Review only; a normal check at Pre-flight and Physical Scan.

**D-71 — DACA Pre-flight focus.** Date: 2026-10-02. Source: Max. Max, verbatim: "pre
flight is more concerned about the corrected pages matching the marked forms. check for
sigs, and card details, and if there are ANY departures in the marked files then yes
check."
- Active: client corrections (D-68), signatures, G-1450 card and cardholder details.
- I-821D departures: checked only when the client's markups show departures.
- [Claude] Everything else is off at Pre-flight in the Lab for now, pending Max's answer
  on whether name / A-Number / address consistency should still run there.

**D-72 — Pre-flight: corrections must reach every form; marked files are the new truth.**
Date: 2026-10-02. Source: Max. Answers the D-71 follow-up. Max, verbatim: "if we changed
the address on the 821d we MUST have changed it on all the others. the marked files are
our new truth basically bc client filled it, but sometimes we dont include some of the
stuff that they fill like the country on american addresses. we dont include united
states in country bc for us addresses it is OBVIOUS that its in the us. except on the
I-90 but that is another form and we are not concerned w that."
- Name, A-Number and address consistency run at Pre-flight.
- A correction made on one form but not carried to another is attention. In the Lab it
  turns the matching consistency check red once rather than counting twice.
- "United States" written by the client as the country on a US address is not a missed
  correction; the firm leaves it off on purpose. The I-90 exception is out of scope.
- [Claude] "New truth basically": corrected values are still **proposed** to the
  reference record (D-55), not written automatically. **Confirmed 2026-10-02.** Max: "keep
  them as suggestions to confirm".

**D-73 — Pre-flight never expects the full form set.** Date: 2026-10-02. Source: Max.
Narrows D-56's "whole review" for Pre-flight. Max, verbatim: "nah we might just put only
corrected pages so this part rly relies on individual or only available forms. bc the
1145 might already be all good so why correct it yk. its only for the stuff that needs
correcting". A form left out of Pre-flight is never flagged, not even as a heads-up.
[Claude] D-57's light notice for missing EAD evidence in Pre-flight is still in the Lab;
it may now be noise under this answer. Asked next.
**Exception, Max 2026-10-02:** "unless marked files do include a form that is marked and
the checker doesnt have the corrected page." A marked-up form with no corrected page is
attention.
**D-57 partly superseded, Max 2026-10-02:** drop the missing-evidence notice in
Pre-flight ("yes drop"). Pre-flight shows no missing-form or missing-evidence notices.

**D-74 — The review stages need an EAD and an address first.** Date: 2026-10-02.
Source: Max. Supersedes D-9's "they might even choose review and do the check at the end"
and D-63's empty-approval reading. Max, verbatim: "ead MUST be present before drafting so
yes it must be filled in first. at least from an ead and address."
In the Lab: the stages open once an EAD document is on file, the EAD details (name, date
of birth, A-Number, expiration) and the address (street, city, state, ZIP) are filled in,
and the record is approved. Approval itself is still never blocked (D-11).
[Claude] Conflicts with D-48 ("sometimes we dont even have that, but thats rare"). Asked
next: what happens in the rare no-EAD case.
**Answered 2026-10-02.** Max: "wellllll they should get pushed back. but if there is rly no
ead and we must move forward without evidence. then they can". Staff are stopped first;
a deliberate "no EAD for this case" step lets them continue. [Claude] In the Lab that
step waives the EAD requirements only; the address is still required.
Wording, Max 2026-10-02: "i rather it says there is no evidence for this case."

**D-75 — Staff can sign a stage off.** Date: 2026-10-02. Source: Max, verbatim: "each
stage should have a check mark that staff can check if there was no issue so that we
can move on to the final scan without the "needs attention" always bugging us even when
we corrected yeah?" In the Lab: a "Mark this stage reviewed" check under each stage's
results turns that stage green in the tracker. The report itself is unchanged; a new
run clears the sign-off.

**D-76 — Each rule is editable in the rulebook.** Date: 2026-10-02. Source: Max: "allow
on rule book to edit individual files" (read as rules). Wording, and form/page/item for
form rules. In the Lab, edits apply to later Draft Review and Pre-flight runs.

**D-77 — Case type is locked once a case starts.** Date: 2026-10-02. Source: Max: "once a
case type is settled and a check opened, it should not allow to change up, it shouldnt
even say start."

**D-78 — Skip deploying v1.2; build v2.0 next.** Date: 2026-10-06. Source: Max, verbatim:
"Since v1.2 never got deployed, we are just going to jump to v2.0 . so that we can start
testing to see if it works well or not." v2 is accepted as the scope (D-52 to D-77).
v1.2's committed code is the base v2 builds on; its Physical Scan becomes v2's.
[Claude] B-1 still stands: nothing pushed, migrated, or deployed without Rob.

**D-79 — The reference record is built from evidence, independent of the drafts.**
Date: 2026-10-06. Source: Max, correcting Claude. Claude had suggested Evidence Zero
duplicates the portal client card (which the portal's form filler drafts from). Max:
"does the design we made actually duplicate the record, o rhave you misunderstood how it
should work... right now portal sends to api and it gathers the info. we have adapted
that into our evidence zero." [Claude, conceded] It is not a duplicate. The record comes
from the evidence through the API, the same way v1.2 reads the package. Pulling it from
the client card that filled the forms would check the forms against their own source
and could never catch a client-card typo (D-15).

**D-80 — Full SSN back from the API, hidden behind a toggle.** Date: 2026-10-06. Source:
Max: "lets add the toggle to see and not see ok?" [verified] The SSN already goes to
Claude inside the PDF; v1.2's prompt asks only for the last four back and the server
rejects a full SSN (proof-scan-contract.js containsFullSsn). v2 asks for the full SSN and
shows it masked until staff press the eye; one toggle shows or hides it everywhere.

**D-81 — Address comparison is per form.** Date: 2026-10-06. Source: Max: "address
format should be smart. depending on each form." [verified against the portal's field
maps] G-28, I-821D, I-765 and G-1450 share one shape: street number and name,
Apt./Ste./Flr. plus number, city or town, state, ZIP. Differences: I-821D and I-765
mailing addresses add an "In Care Of" name; G-28 adds province, postal code and country
for foreign addresses; G-1145 and I-765WS carry no address. A form is compared only on
the parts it has.

**D-83 — A Proof Scan case is a folder.** Date: 2026-10-07. Source: Max: "lets do
folder." Answers plan decision 1.1. Pressing Start creates a folder holding the locked
case type, the Evidence Zero reference record, and each stage's sign-off; every scan
report saves into it (the existing reports table plus a folder reference). Staff find a
folder by client name or A-Number. **Not linked to portal matters or client records for
now.** Max: "right now we do not need to link it, but we might do that to connect the
records. BUT not now okay."

**D-84 — No PDFs are kept; reports are.** Date: 2026-10-07. Source: Max, verbatim: "its
fine i dont think we need to keep the pdfs. we dont already keep it so why keep it? we
do keep the report. so the record can be kept." Narrows D-55: Evidence Zero keeps the
facts it read and a short card per document, not the file. Supersedes the plan's
retention question (1.2) and Q-31 for v2.

**D-85 — v1.2's uncommitted last batch is not committed on its own.** Date: 2026-10-07.
Source: Max: "1.2 is not necessary right now because we have moved past it." [Claude
reading] The v2 build reuses its useful parts (client-role refusal, stricter
validation) directly.

**D-86 — Possible issues ships at launch, in the same AI request.** Date: 2026-10-07.
Source: Max: "possible issues is safe for launch" and "on portal, sometimes it checks for
stuff we did not tell it to check... soooo". Answers plan decision 1.3. [Claude] The live
checker already volunteers unrequested findings at no extra cost, but mixes them into
the official result (N-015, N-016). v2's closed schema removes that from the official
part, so the same ideas go into a separate Possible issues section of the same answer:
a few cents of extra output per scan, no second request. Still powerless (D-36).

**D-87 — Wording is replaced after launch; Max tests on the live site.** Date:
2026-10-07. Source: Max, verbatim: "we can replace after launch since I will be testing
in the actual live site". Answers plan decision 1.4. v2 ships with Claude's placeholder
copy; Max rewrites it after launch.

**D-88 — v2 runs next to the old checker while Max tests.** Date: 2026-10-07. Source:
Max, verbatim: "v2 available to all staff. next to old checker. just while testing."
Both checkers stay available to all staff on the live portal until Max signs v2 off;
then the old checker is removed (plan Batch 6).
**Clarified 2026-10-09.** "Old checker" means the checker live today (the HTML checker,
verified identical to `main`'s `pages/proof-scan/proof-scan.js`), not v1.2. Max: "Didn't
we agree that we would get the old checker next to the new one while I tested?" [Claude,
error] The `proof-scan-v2` branch as pushed (`fc489c5`) has v1.2 at the existing route,
because it was built on the v1.2 branch; Claude raised this as an open question instead of
recognising that D-88 already answered it. To fix on the branch before Rob deploys.

**D-89 — Client details appear once, on the case card; Physical Scan flags differences.**
Date: 2026-10-07. Source: Max, verbatim: "we designed it to only include on our own case
card. if the physical scan's report is DIFFERENT from the one that is logged in our case
card, it must immediately tell us. but no more of that clunky v1 info vomit that checker
on portal does." Answers plan 1.5 (first half). The Physical Scan report no longer
prints a client block. Each value the scan reads (name, A-Number, date of birth, EAD
expiration, SSN, phone, email, address) is compared with the case card and any
difference is an item needing attention at the top of the report. Name order, middle
initials, A-Number formatting and address punctuation are not differences.

**D-90 — v2 ships with an "open" Physical Scan for any case type.** Date: 2026-10-07.
Source: Max, verbatim: "we need an "open" physical scan. bc it will take me a bit to get
the aos and other case types working. and i want it to be able to check evidence and etc
without the case type specific checks for any case. otherwise we kind of ship without a
crucial part tbh." Builds on Q-42 (forms-only profile, 2026-09-11). Open questions,
asked one at a time: whether "open" covers only Physical Scan or every stage; how name
consistency handles more than one person (N-006); what the Evidence Zero gate is when
there is no EAD (D-74 is DACA-shaped).

**D-91 — The gate is the "evidence requirement".** Date: 2026-10-07. Source: Max: "no ead
but evidence is still a requirement on all... we should better call it evidence
requirement". Approved as proposed ("1. ok"). Renames and generalizes D-74: every case
type needs evidence before the stages open. DACA: the EAD plus the address (D-74 as
decided). General: at least one evidence document of any kind. The deliberate "no
evidence for this case" step stays (D-74 follow-up).

**D-92 — The open case type is called "General".** Date: 2026-10-07. Source: Max, "2.
ok" to Claude's proposal. Wording stays Max's to change (D-87).

**D-93 — General has all four stages, same engine, firm-wide checks only.** Date:
2026-10-07. Source: Max, "3. ok"; Max expects to use mostly Physical Scan. General runs
the 7 firm-wide checks with the stage settings Max set for DACA's firm-wide checks
(D-70 to D-72), the case-card comparison (D-89), evidence identification and
readability, and Possible issues. It never applies an expected-forms list.

**D-94 — One case card per person; names are checked per person.** Date: 2026-10-07.
Source: Max, verbatim: "have it make more case cards. that way we may include evidence
such as BC for pet, MC, BC for ben. etc its usually like two people, sometimes three."
Answers N-006 and the multi-person kink in D-90. A case holds one card per person
(usually two, sometimes three), each with its own role (applicant / beneficiary,
petitioner / sponsor, joint sponsor, household member, per N-006) and its own reference
record. Each evidence document belongs to one person, or to several (a marriage
certificate belongs to both spouses). The AI proposes whose document it is; staff can
correct it, like the document type (Q-45). Name, A-Number and address checks compare
each person only with their own entries; evidence in the petitioner's name is matched to
the petitioner, never flagged against the beneficiary. A document whose owner is unclear
goes to Possible issues. DACA stays one person.
[Claude] For the evidence requirement (D-91) with several people, the Lab will require
evidence for the main person only and show the others as recommended. Max to confirm.
**Answered 2026-10-07.** Max: "mainly the beneficiary or petitioner." Evidence for the
beneficiary or the petitioner satisfies the requirement; others are recommended.

**D-95 — General can go straight to Physical Scan, evidence included in the package.**
Date: 2026-10-07. Source: Max, verbatim: "in "general" we can skip to the physical scan
to make things simpler, tho at the end physical stage we can just drop the entire thing
and all the evidence WILL be and should be inside the physical scan. along w taxes and
etc." Narrows D-91 for General: no evidence gate; staff may open Physical Scan directly
and upload the whole package, forms and evidence together. The scan identifies the
people and the evidence inside the package and builds the case cards from it; with no
Evidence Zero record, differences are checked across the package itself (D-11).
[Claude] Build note: an AOS-sized package with tax returns can run to hundreds of pages
and past v1.2's 12 MB cap; the build must accept larger files and split them across
several AI requests (limits: 32 MB and 600 pages per request).
**Corrected 2026-10-07.** Max: "an aos package is 137 pages max and checker can handle it
rn. we can express the mb limit and have it reduced if needed ok." No splitting: the
upload shows its size limit and staff reduce the file if it is over.

**D-96 — Blank fields stay one attention item per field, per form.** Date: 2026-10-07.
Source: Max: "each item per field of attention. for each form ok." Answers plan 1.5
(second half). No grouping.

**D-103 — Physical Scan is always open; re-running never asks for approval again.** Date:
2026-10-09. Source: Max, live test, verbatim: "even if i didnt have ead. i should just go
ahead adn go to the last step if all i wanna do is check the final scan" and "it also made
me go and aprove the reference record when i wanted to run another proof scan on the same
page... thats dumb." Narrows D-74/D-91: the evidence requirement only gates Draft Review and
Pre-flight, for every case type; Physical Scan never waits on it; editing the record never
blocks a re-run.

**D-104 — A partly readable EAD still fills what it read clearly.** Date: 2026-10-09.
Source: Max: "it did not type in the record for me. it made the card, but did not fill in
the record." [Claude, verified in code] The live engine fills nothing unless the AI calls the
whole document "clear" (D-54), and the gate counts only a "clear" EAD, so a real scan read as
"partial" blocked the case even after Max typed the values. Fix: a partial EAD counts as the
EAD on file and fills empty fields it read clearly; fields it lists as unreadable are skipped,
and it never creates suggestions (D-54's purpose kept).

**D-105 — No "not on the case card yet" note at all.** Date: 2026-10-09. Source: Max:
"this is also kinda stupid". Supersedes D-102's DACA half and Q-46's light note.

**D-106 — No "forms found in this package" list.** Date: 2026-10-09. Source: Max: "perhaps
find a way to make this info cleaner or jsut remove all together doesnt seem helpful if its
not pretty, plus we already know its checking all the forms from prior." Supersedes D-100 #3.

**D-107 — G-28 "EAD home or office": all boxes empty means home, and is fine.** Date:
2026-10-09. Source: Max: "if all checkboxes are unchecked we mean it to go home. we almost
always want it to go home. this is an awful false negative." Changes DACA-G28-003.
Office box ticked: a gentle confirm, never counted. Max, verbatim: "gentle confirm please."

**D-108 — Edition dates are checked against USCIS's live edition.** Date: 2026-10-09.
Source: Max: "can we havea way of it actually checking USCIS's edition date record? the
forms are current." [Claude, verified in code] The weekly USCIS check already stores the live
edition (`form_editions.upstream_edition`) but only flags the reference as stale; the checker
still compares against the stale reference, so a current G-1450 (02/06/26) was called FATAL
against 06/03/25. Fix: a form matching USCIS's live edition passes; wording states what the
form shows and what USCIS publishes.

**D-109 — A problem's headline says what is wrong, never the rule's name.** Date:
2026-10-09. Source: Max, verbatim: "the fact that it states the rule confuses staff. yes we
know the rule is that required sigs are presentt. but in the way its present, it reads as IT
telling us that they are present but with a fatal flag. lets change this please." Example:
"Required signatures are present." shown as a FATAL headline over "The I-765 preparer/attorney
signature page is not in the package". Fix: an item needing attention leads with the finding
in the house pattern (N-023), e.g. "The I-765 signature page (page 6) is missing. Every
required signature must be in the package." The rule's own wording ("... are present.") is
only ever used for a cleared check.

**D-110 — The EAD's middle name is a gentle confirm.** Date: 2026-10-09. Source: Max,
verbatim: "ead doesnt show full middle name. so.. if the back is not provided. just a gentle
confirm if the middle name was verified with client or client's record yeah?" Built in
v2.0.1 (DACA only, never counted): when the forms carry a full middle name and the EAD on
file shows only an initial or none, staff are asked whether it was confirmed with the client
or the client's record. [Claude, interpretation, unverified with Max] "If the back is not
provided" read as: no other evidence shows the full middle name. If any other document
(birth certificate, passport and so on) shows it, the question is skipped.

**D-97 — A different SSN from a newer document becomes an encrypted suggestion.** Date:
2026-10-07. Source: Max, "2. ok" to Claude's proposal after terminal Batch 1 left it
open. The suggested SSN is stored encrypted like the main one, and shown masked behind
the same eye toggle (D-80). Document facts still never hold a full SSN.

**D-98 — The evidence must match the forms. This is the biggest general check.** Date:
2026-10-07. Source: Max, verbatim: "a general check should be that THE EVIDENCE MATCHES w
the forms. that is the BIGGEST thing it must take into account." Every fact a piece of
evidence carries (names, dates of birth, marriage date, and so on) is compared with the
forms about the same person; a difference is an item needing attention. It applies to
every case type: in DACA it is the EAD against the forms (already done through the
reference record), in General it is each document against its owner's forms.
[Claude] Build note: the firm-wide rule set needs a new check for this (the 7 firm-wide
checks do not cover it), added to the seed in a later batch.

**D-99 — General shows a full case card for every person.** Date: 2026-10-07. Source:
Max: "AOS general needs some work. specificallly for the case cards ttheyre not showing
for both pet and ben." Petitioner and beneficiary each get an equal case card, not one
main card plus a small one. [Claude] Cards also appear when a Draft Review or Pre-flight
finds the people in the forms; values taken from draft forms are shown as such and are
never used as the truth the forms are checked against (D-79).

**D-100 — A well-rounded General checker.** Date: 2026-10-08. Source: Max: "i am very
interested on having a well rounded general checker. bc aos, and pip, and i90, and so on
can go there before i get the checklist specific items". Answers Claude's candidate list:
- **Full case cards.** Each person's card holds the facts the portal's own 36 form maps
  fill per person [verified]: name, A-Number, date of birth, address, phone, email, SSN,
  USCIS online account number, country of birth and citizenship, I-94 number and expiry,
  last entry date and port of entry, employer, marriage date and place. Shown when a
  document or form carries them.
- **1, yes:** every shared fact must match across the forms, per person (extends PS-301
  to PS-303 to the full fact list).
- **2, yes:** evidence matches the forms on the full fact list (extends D-98).
- **4, no.** Max: "no it will cause issues." No generic G-28 coverage check.
- **5:** expired evidence (an expired passport, for example) goes to Possible issues
  only. Max: "mmm ok goes to possible issues."
- **6, yes, as a rule:** foreign-language evidence without a translation is a counted
  check. Max: "good yes add as rule."
- **3, yes, information only:** the report lists the forms found in the package, with no
  required list and nothing counted. Max: "alright. since its just informational".

**D-101 — No folder-name prompt; the folder names itself.** Date: 2026-10-08. Source: Max,
verbatim: "im not sure the folder name ask is wise, it should create it by itself when we
run the scan... so names + case type." Supersedes terminal's Batch 3 choice. Start asks
only for the case type; the folder is named from the people's names plus the case type
once a document or scan reveals them.

**D-102 — No "not on the case card yet" note in General.** Date: 2026-10-08. Source: Max
reacting to it ("what is that???"). [Claude] It was the Q-46 light note listing every
empty case-card field, including DACA-only ones, on a General case that went straight to
Physical Scan, where the card is built from the package anyway (D-95). Removed for
General; in DACA it lists only fields the package's forms actually use.

**N-043 / Build log, 2026-10-07.** Terminal Batch 1 done on branch `proof-scan-v2`
(worktree `katychavez-portal-v2`), 7 commits `7289a66`..`5eea9d0`, 781 tests passing
[verified by Claude]. Migrations 2000 to 2003 written, never run. Max approved installing
Postgres locally to test them on a throwaway database (no dev, no prod).

**D-82 — In Care Of and foreign-address parts appear only when a source has them.**
Date: 2026-10-06. Source: Max, verbatim: "if in care of is present (which i have never
seen to be) then if record and postal code and country then add it, but most of these
things are not gonna come from our ead or intake. if they do then have it be added
okay?" In the Lab: In care of, province, postal code and country are not shown in the
reference record until a document carries one. A US country is still never a missed
value (D-72).

**Note, UI (not a decision yet).** Date: 2026-10-02. Max, verbatim: "i feel like there
should be more colors to indicate information. i.e evidence zero was just done, why is
everything in the same color, u know what i mean? maybe we could also have like a
better UI. ik we are still at alpha, but still..... keep a note for that." 

---

## 3. Open questions

The current continuation queue comes first. Older questions below remain useful
research notes, but some have been resolved or narrowed by D-52 through D-61 and
must not be reopened blindly.

### Current continuation queue

**Q-44 — Stage mapping ANSWERED for DACA Draft Review and Pre-flight 2026-10-02 (D-69 to
D-72).** Physical Scan runs the full set (D-58). Original wording kept below.

**Q-44 — DACA Physical Scan catalog.** With the v2 operating model settled, walk
through the existing v1.2 DACA profile with Max and confirm the exact form/evidence
contract for Physical Scan. Start from the firm's existing checklist and profile; do
not add requirements from model knowledge.

**Q-45 — ANSWERED 2026-10-02.** Max: "yes they should be able to correct it. but idk when
that would happen tbh." Staff can change the identified document type. Original wording:

**Q-45 — Automatic document identification correction.** Evidence Zero identifies a
document type. Does staff need a way to correct that identification before it affects
the reference record or the case-type evidence set?

**Q-46 — ANSWERED 2026-10-02.** Max: "if rly it was never added then B": a value never
added to the reference record is a light heads-up in Pre-flight and Physical Scan, not an
attention item. Forms are still checked against each other (D-11). Original wording:

**Q-46 — Other missing reference values after drafting.** Pre-flight's treatment of
missing expected final evidence is settled: light notification only. What should a
missing reference value mean in Pre-flight versus Physical Scan? Do not infer an
answer from D-50's older broad wording.

**Q-47 — ANSWERED 2026-10-02.** See D-62. Full SSN is shown to staff.

*Original question, kept for history:* **SSN privacy boundary.** D-12 and the 2026-09-25 discussion require SSN in
the editable DACA reference record, potentially pending at intake. D-40 forbids full
SSNs in Proof Scan and permits only `ssn_last4` to be handled or shown. Before build,
Max must resolve whether the v2 reference record links to an already protected source,
uses a separate protected field, or is limited to a status/last-four representation.
Do not weaken D-40 by accident.

### Legacy queue and research notes

### Intake and reference record

**Q-1 — ANSWERED 2026-09-09.** See D-45 and D-46. The EAD wins for the fields it
carries. Prima is firm tooling, not a source of truth, and is not connected to
anything anyway.

**Custom instruction drafted 2026-09-11 — retire signature date order.** Written for
the live checker's firm-wide `proof_scan_config.custom_instructions` box. Not yet
entered by Max. Deliberately preserves "signed but not dated", which check 4 does not
cover on the live prompt:

```
Check 5 (signature dates - attorney must not sign before applicant) is retired.
This firm does not treat signature date order as a defect. Never report it, and
never mention the relative order of two signature dates or the gap between them,
including as a note or remark alongside another finding.

This does not change check 4. A required signature that is missing, or a signature
with no date written beside it, is still reported.
```

Context: R-1. The rule was retired by Rob and Max on 2026-08-21 but the retirement
only ever landed on the unpushed `module/proof-scan-rules` branch, so it is still
live in production.

**Q-43 — Multi-pass AOS on the live checker.** [verified 2026-09-11] Max asked about
scanning an AOS case in passes (I-130 + I-130A + evidence, then I-765 + evidence).

Two facts that make this cheaper than expected:

- **The live checker has no package composition check at all.** Its rule 2 is page
  counts "for each form identified", per form found. It never asks whether the right
  forms are present. A partial set already works with no instruction needed. (v1.2 is
  the opposite: composition is the whole point there.)
- What actually breaks is **two people in one package**: name, A-Number, and address
  consistency across petitioner, beneficiary, and evidence held in the petitioner's
  name.

What is worth putting in the firm-wide box, all universal and harmless on a DACA scan:
retire signature date order (Rob and Max killed it in August but it is still live);
extend roles past the two the prompt knows; allow a legitimate address difference
between petitioner and beneficiary.

What cannot be expressed: anything per-pass. `proof_scan_config` is a singleton, one
row for the whole firm, so "this pass is I-130 plus evidence" is unsayable.

**Warning, verified:** if `notify_email` is set, the live checker emails it on **every**
scan, unconditionally, with no status gate. Test scans included. Whether it is set is
still Q-30, unanswered since 2026-08-20.

**Q-42 — A "forms only" profile.** [verified 2026-09-11] Max asked whether he could
run a partial set, e.g. I-130 + I-130A plus evidence, through the checker. v1.2 cannot:
it is locked to `daca_renewal`, the only option in the dropdown, and would report all
eight DACA package items missing. But the profile already separates **7 base rules**
(edition date, page count, signatures, blank/duplicate pages, name, A-Number, address)
from **32 case rules**. A profile carrying only the base rules and no expected package
items would do exactly what Max described, on any form set, with no case type.

Open before that is worth building:

- **Roles.** PS-301 name consistency knows two roles, petitioner and beneficiary. Lab
  note N-006 says it needs four, including joint sponsor and I-864A household member,
  resolved per case. A family petition is precisely where it misfires.
- **Evidence pages.** No evidence rules exist, so evidence in the same file adds
  nothing and naturally carries the petitioner's name, feeding the same misfire.
- **Size.** The 12 MB cap is fine for forms and will not hold an AOS evidence set.

**Q-41 — AOS evidence: the checker knows none of it.** [verified 2026-09-11]
Only one scan profile exists, `daca_renewal` v1. No AOS profile. I-485 appears in the
checker solely inside the form-editions string (24 pages, edition 01/20/25), which is
page dimensions, not a rule. The catalog's evidence section (PS-7xx) is entirely
proposed, and its intended home, a `proof_scan_evidence_requirements` table, exists
nowhere in either repo.

The portal does carry an AOS document list, in migration 1109's
`doc_template_library`: medical exam (I-693, sealed), evidence of lawful entry, and
proof of continuous physical presence, on top of the immigration-wide items (passport,
I-94, birth certificate, pay stubs, W-2s, tax returns, bank statements, I-864).

Two reasons that list cannot be reused as-is:

1. It is a **request** list, what the firm asks a client to upload. Proof Scan never
   reads it, and nothing checks a package against it.
2. It was seeded by whoever wrote the portal template, not authored by this firm.
   Rob's own catalog warns against exactly this: "build from the firm's checklist,
   never from the model's own knowledge of practice." Three AOS rows is a starter
   list, not a real evidence requirement set.

**Q-34 — How is a document designated as evidence?** Does staff mark it, or is it
inferred from document type? Raised by Max 2026-09-09, see D-49.

**Q-35 — ANSWERED 2026-09-09.** See D-50. The stage decides, automatically. Intake
and drafting tolerate missing information; after that it is a real issue. One wording
ambiguity noted in D-50 remains to be closed while defining the stages.

**Q-2** — Can staff mark a source as unreliable, superseded, or unclear?

**Q-3** — Does the system store the exact source location of a fact, not just the
value? Page, field, document.

**Q-4** — Can a confirmed value be replaced later, and how is that audited?

**Q-5** — Do intake, identity evidence, civil documents, prior filings, and
staff corrections carry different priority? Is priority per fact, per case type,
or per stage?

### Stage selection

**Q-6** — Fixed stages per case type, or configurable?

**Q-7** — May the checker suggest a stage while staff confirms it?

**Q-8** — Final user-facing labels. "Mailing stage" was floated for stage 4.

**Q-9** — Can a case move backward after a revision or conflicting evidence?

### Draft review

**Q-10** — Per form and stage, what must be complete, what may be pending, and
what is not applicable? The concrete example is the I-765WS: financial
information may legitimately be missing until the client supplies it, but the
firm's standard explanation for why the person seeks employment authorization
should already be there before the draft goes out. These two must not be treated
the same.

**Q-11** — How are firm template text and client values told apart?

**Q-12** — What happens when only some forms are uploaded? Early drafts may hold
only a G-1145 and a G-1450, or staff may complete everything in one pass. The
checker cannot assume the same set every time.

### Evidence and in progress

**Q-14** — What useful output follows one new document arriving?

**Q-15** — Should a document carry a status: supports, conflicts, replaces,
duplicate, unreadable, unrelated?

**Q-16** — Which changes trigger a recheck of earlier forms?

**Q-17** — How does staff approve a replacement or a changed fact?

### Final assembly and physical scan

**Q-37 — DACA-ASM-001 ships fatal without carrying its own definition.** [verified
2026-09-09, corrected same day] The shipped profile has the rule titled "All pages in
order", severity fatal, and contains no ordering spec. But Rob's catalog
(`PROOF-SCAN-RULES.md`, PS-104) does draft one, and it is narrower than the title
suggests:

> "Flag pages of one form interleaved into another, or a form's pages out of
> sequential order."

That is **internal** order and it needs no reference document at all. An I-765 runs
pages 1 to 7 in sequence with no G-28 page wedged in the middle; the checker can see
that from the pages themselves.

Two real gaps remain:

1. The shipped profile does not carry that definition, so the model is not told it.
   The rule reaches it as a bare title.
2. **Form-to-form order is specified nowhere.** Whether the G-1145 goes before or
   after the G-28 is not in the catalog, the profile, or the firm checklist. See Q-39.

Also worth noting: PS-104 is still marked PROPOSED in the catalog with its severity
checkbox blank and its "do NOT flag" line empty, yet it shipped in v1.2 at fatal.

**Q-39 — Does the firm have a fixed form order for a DACA package?** If yes, write it
into the profile and PS-104 becomes a real check. If the order genuinely does not
matter to USCIS, the form-to-form half of the rule should be dropped rather than
guessed at.

**Q-40 — Two proposed catalog rules are stage-4 material and unbuilt.** [verified
2026-09-09] PS-105 (legibility and scan quality: cut-off pages, rotated pages,
resolution too low to read) and PS-106 (barcode / form-type confirmation: the form a
page claims to be matches the form it was filed under). Both are exactly what a scan
of a printed package needs, both are still PROPOSED, and PS-106 is the cheapest
substitution check available.

**Q-38 — Which kind of reference does stage 4 need?** A **specification** (which
forms, how many pages, in what order) or the **approved file itself** (the exact
assembled PDF from stage 3, frozen)? The first is nearly free, since the profile
already holds it minus the order. The second is the only thing that catches a page
that is structurally correct but is not the page that was approved. See Q-36.

**Q-36 — Where does the approved print-ready reference come from?** Under D-51,
stage 3 assembles the package and stage 4 scans the printed one. The physical scan
can only find a missing, duplicated, substituted, or reordered page by comparing
against a version someone explicitly approved as the one that went to the printer.
Does stage 3 end with that approval?

**Q-18** — Who approves the print-ready reference?

**Q-19** — Does the tool assemble the merged PDF, or only validate one?

**Q-20** — Which ordering rules are authoritative, and are they case-specific?

**Q-21** — Which post-print differences are expected? Handwritten signatures,
annotations, separator sheets, and scanner noise must not read as mismatches.

### Exploratory learning

**Q-22** — What schema constrains a suggestion without making it official?

**Q-23** — Who may accept, dismiss, nominate, approve, edit, retire, or restore?

**Q-24** — What is the precise scope of "never suggest this again"? Package, case
type, firm, suggestion pattern, or model version? A rejected example must not
accidentally suppress a legitimate concern somewhere else. Until this is defined,
the option cannot truthfully exist.

**Q-25** — How are similar suggestions clustered without overgeneralising?

**Q-26** — How is model and prompt-version behaviour audited?

**Q-27** — Should exploratory findings ever generate email? Current direction: no.

---

## 4. Rejected and reversed

Things we decided against. They live here so they do not come back.

**R-1 — Signature date order. Deleted, not dormant.**
Date: 2026-08-21. Rob and Max together. Max, verbatim:

> "rule 5 is just flat out hallucinated and WRONG. rob and i made a note to delete
> that one bc signature date order is just not a thing for our firm."

This was PS-202. It is absent from the DACA v1 profile, so the rewrite already
honours the decision (verified 2026-09-09). It is also the named example of
reasoning the model must stop re-suggesting.
*Still open [unverified]:* whether it is "not a thing" because the firm always
signs same day, or because USCIS does not reject on it. The answer changes
whether other firms using the template would want it.

**R-2 — "Five proofs" as five evidence categories. Wrong reading.**
Date: 2026-09-04. Corrected to five review moments. See D-6.

**R-3 — I-485 as a universal baseline. Wrong reading.**
Date: 2026-09-04. I-485 belongs inside an Adjustment of Status case. It is not
present in DACA and cannot govern DACA facts. Katy likely mentioned it because it
is drafted early and often by her. Within AOS it may be one important source among
several, and it does not automatically outrank civil documents, identity
documents, or intake answers.

**R-4 — Building AOS first. Not authorised.**
Date: 2026-09-04. Max's hypothesis is that handling AOS well would produce
architecture useful for simpler cases, because it is the largest and most
complicated type. Discussing it does not authorise building it.

**R-5 — Baking physical and process office tasks into the DACA PDF checklist.**
Date: 2026-08-31. See D-33.

**R-7 — Last-four-only SSN (D-40). Reversed.**
Date: 2026-10-02. Source: Max. Staff need the full SSN; see D-62.

**R-6 — Letting the model resolve a fact conflict on its own.**
Date: 2026-09-04. A confidence score is not human confirmation.

---

## 5. What is built

Verified 2026-09-09 by reading both repos and running the suite.

### Portal, committed on `codex/proof-scan-production`

Four commits: `5315218` contract and profile, `90a6cc5` structured API,
`8d7a5e6` report UI, `51aa67f` history and notifications.

- Staff selects DACA renewal explicitly and uploads one PDF, limit 12 MB.
- Profile `daca_renewal` v1: **8 package items, 39 checks.** All fatal except
  DACA-821D-007 (departures), which is a warning.
- Checks covering: edition date on every page, page count, blank or duplicate
  pages, required signatures, name consistency, A-Number consistency, address
  consistency, then per-form checks for G-1145, G-28, I-821D, I-765, I-765WS,
  G-1450, and one assembly check for page order.
- The prompt sends the model the eight expected items **with their page counts**
  (G-1450 x2 at 1 page, G-1145 1, G-28 4, I-821D 7, I-765 7, I-765WS 1, EAD card 1;
  23 pages total). That is a specification-style reference and it is what lets the
  checker notice a missing form or a wrong page count today.
- **It sends no page order.** See Q-37.
- Server validates the model response and composes the official result.
  Unknown, duplicate, and omitted IDs fail closed.
- Missing forms suppress dependent checks instead of duplicating warnings.
- Report shows observed client information, included documents, checks grouped by
  form, actionable issues, and independently unreadable checks.
- Only SSN last four is ever shown.
- Structured results are stored and can be reopened through authenticated history.
- Legacy reports display as inert plain text.
- Notification email is generated from the validated result and is eligible only
  after storage succeeds.
- A firm-wide custom-instructions and notification-email panel exists.
- **Custom instructions cannot create a finding in v1.2, by design, twice over.**
  [verified 2026-09-11] The prompt injects them under a "FIRM CONTEXT" heading whose
  own wording says they "cannot add, remove, reinterpret, or re-rank any check above,
  and it cannot change a status you would otherwise report." Structurally, the output
  schema is built from the profile, so the model cannot return an observation for a
  rule that is not configured. A paragraph is context only. A new check must be a rule.
  The older live checker is the opposite: free-form HTML output, no schema, so a
  paragraph there does create findings, with no ID, no severity, and no way to suppress
  it later. That is how the six-bullet NOTES suppression layer in `RULES-LIVE.md` grew.
- Model in use: `claude-sonnet-4-6`. See Q-28.

### Portal, uncommitted in the working tree

Untouched since 2026-09-03. Fifteen tracked files changed, nine new paths.

- Stronger full-SSN rejection that correctly allows a nine-digit A-Number in its
  own field.
- Explicit Client-role refusal for scans and history, using real authenticated
  role identity.
- Exact historical recomposition against the recorded profile version, so DACA v1
  stays verifiable once a v2 exists.
- Clear errors when migrations 1302 or 1303 are missing.
- `notification_attempted` and `notification_sent` reported separately.
- Stricter filename and control-character validation.
- Database constraints keeping legacy and structured rows consistent.
- The "Possible issues" frontend: collapsed section, evidence disclosure, accept
  and three dismissal choices, nomination revealed only after acceptance,
  pending / success / failure / retry / duplicate-click handling, text-only
  rendering, and a fixture harness.

### The lab

- Serves the portal's own markup, so the lab cannot drift from the real page.
- Report design approved, DACA renewal checklist as the rule source, base rules
  inherited by every case type.
- `NOTES.md`, notes N-001 through N-025, is the decision log.
- `RULES-LIVE.md` is the verbatim extraction of the rules actually running in
  production as of 2026-08-21, with the mapping to Rob's PS catalog.
- Four fixtures: known-good DACA, today's false positives, error-injected, and
  everything-wrong.
- Ten modified files and the exploration preview are uncommitted as of
  2026-09-09. The newest of them was last touched 2026-09-03.

---

## 6. Not built

None of this exists in any form.

- Intake and source-record stage.
- Process-stage selector.
- Source extraction and a staff-confirmed reference record.
- Fact provenance and stored source locations.
- Source priority and conflict resolution.
- Draft-form comparison against confirmed facts.
- A continuing case workspace with document versions and prior human decisions.
- Evidence and in-progress review.
- AOS profile.
- Final PDF assembly.
- An approved print-ready reference.
- Physical package comparison scan.
- Real exploratory generation. **The server never sends suggestion data and there
  are no routes to save an accept, a dismissal, or a nomination.** The section can
  only appear in the local fixture harness. That is exactly what was assigned, so
  it is not a defect, but the feature is a shell.
- Any link between a scan and a client or matter record.

The portal contains a separate pre-existing client-intake system. It is not
connected to Proof Scan.

---

## 7. Blockers and ownership

**B-1 — Nothing is pushed, and nothing may be.** Local commits may be prepared.
Do not push until Rob identifies the intended handoff workflow. Do not apply
migrations or deploy until Rob authorises or performs it. Do not deploy this
template checkout over a client repository.

**B-2 — Migrations 1302 then 1303, in that order, are required** before the
structured checker can work safely. They are applied nowhere. The dev ledger
records 1300 and 1301 only. The production ledger records no Proof Scan migration
at all. [unverified: the ledgers are hand-maintained text files, so treat this as
a strong signal, not proof.]

**B-3 — Integration evidence that does not exist yet.** A real PDF and model run
on a redacted DACA package, Supabase persistence and history, Resend delivery, and
an authenticated deployment smoke test.

**B-4 — An older `module/proof-scan-rules` branch** holds two changes: retiring
PS-202 and failing scans that never really ran. Neither is in the current branch
(verified 2026-09-09). PS-202 is already handled by the rewrite (R-1). The
"scan never ran" handling should be reconciled deliberately, not merged blind.

### Open questions for Rob

**Q-13** — Which repository and branch actually serve Katy's live portal? Does
production deploy from `module/forms-page-reorg` rather than `main`? Unanswered
since 2026-08-20.

**Q-28** — Where did the Sonnet 5 change go? The checker currently calls
`claude-sonnet-4-6` (verified 2026-09-09).

**Q-29** — A read-only dump of `form_editions` and the current
`proof_scan_config.custom_instructions`. Both close the lab's fidelity gaps.
Production carries 32 forms; the lab falls back to 15. Contains no client data.

**Q-30** — Is `notify_email` set on Katy's portal today? This determines the blast
radius of a stray scan.

**Q-31** — Add an `r2_key` to `proof_scans` so scans start retaining their inputs.
Every day without it is another day of ungradeable history.

**Q-32** — Would he fund an API key for baseline measurement, and what do the
existing Anthropic billing records say a real scan has cost so far?

**Q-33** — Does this work belong in the client repo or the template? Unanswered
since 2026-08-20.

---

## 8. Archive index

Older documents. Kept for history. Where any of them disagrees with this file,
**this file wins.**

In `katychavez-portal-new`:

| File | Date | What it is |
|---|---|---|
| `PROOF-SCAN-SESSION-HANDOFF-2026-09-04.md` | 09-04 | The session archive this file was seeded from. Still the fullest write-up of the stage model. |
| `PROOF-SCAN-BATCH-5-READINESS.md` | 09-03 | Implementation readiness record. Its test counts are dated evidence. |
| `PROOF-SCAN-PRODUCTION-BUILD-PACKET.md` | 09-02 | The implementation plan for the structured build. Not deploy permission. |
| `PROOF-SCAN-UI-LAB-SESSION.md` | 08-31 | Lab session log, Batches 0 and 1. |
| `PROOF-SCAN-UI-LAB-PLAN.md` | 08-31 | Staged build plan for the lab. |
| `PROOF-SCAN-RULES.md` | 08-31 | Rob's rule catalog, a restructured view of the old prompt. Editing it changes nothing. |
| `PROOF-SCAN-HANDOFF.md` | 08-18 | Rob's original rules-revamp handoff. Explicitly a guideline, not a spec. |

In this lab:

| File | What it is |
|---|---|
| `NOTES.md` | The chronological decision log, N-001 onward. Max writes, Claude logs verbatim with a date. |
| `RULES-LIVE.md` | The rules actually running in production as of 08-21, extracted verbatim from the prompt. |
| `CLAUDE-TAKEOVER-2026-09-25.md` | Claude's launch document: required read order, operating boundaries, and the current next question. |

---

## Changelog

- **2026-10-08**: Shipped to Rob. Portal branch `proof-scan-v2` pushed to GitHub at
  `fc489c5` (new branch only; `main` untouched at `556118c`), with the full handoff in
  `docs/proof-scan-v2/` (start-here README, deploy checklist, build log, a copy of this
  record, plan, specs, history, mockup). Not deployed, no migration applied, never run
  against the real AI. That copy is a snapshot: later decisions logged here must be
  copied there too.
- **2026-10-09**: Rob merged `proof-scan-v2` into `module/forms-page-reorg` (`c566aac`) next
  to the live checker (D-88 honoured), moved runs to queued jobs on Sonnet 5.5
  (`c24302a`), applied 1303, 1304 and 2000 to 2004 to production, fixed the AI schemas
  (`780c403`). Live. Max's first live review: D-103 to D-108.
- **2026-10-09**: v2.0.1 built for D-103 to D-110 on portal branch `proof-scan-v2.0.1`
  (from `module/forms-page-reorg` at `780c403`), pushed as a new branch only, with a PR for
  Rob to merge and deploy. No migration. 914 tests passing [verified by Claude].
- **2026-10-06**: Pre-build checks done: repo synced, security problem found in the
  Proof Scan tables (live today), API limits, rules and AI specs. See
  `PROOF-SCAN-V2-SPECS.md`.
- **2026-10-06**: v2 accepted (D-78). Build plan drafted for Max's review:
  `PROOF-SCAN-V2-BUILD-PLAN.md`. Nothing built.
- **2026-10-02** — v2 Lab review round 1: D-63 (case type, Evidence Zero, then stages,
  summary pinned on top), D-64 (A- prefix, G-28 address format), D-65 (add rules).
- **2026-10-02** — Q-47 answered: staff see the full SSN (D-62, supersedes D-40, R-7).
  Verified the whole PDF already goes to the Anthropic API on every scan.
- **2026-09-25** — Continued v2 scoping: Evidence Zero, Draft Review, Pre-flight,
  Physical Scan, learning, rulebook, and email decisions recorded as D-52 through
  D-61. Added the Claude takeover document and reset the current queue to Q-44
  through Q-47.
- **2026-09-11** — Forms-only profile raised as a cheap v2 option (Q-42).
- **2026-09-11** — Checked whether the checker knows AOS evidence. It does not (Q-41).
- **2026-09-09** — Read Rob's rule catalog. PS-104 does define page order, narrower
  than the shipped rule's title implies (Q-37 corrected). Form-to-form order is
  specified nowhere (Q-39). PS-105 and PS-106 flagged as unbuilt stage-4 rules (Q-40).
- **2026-09-09** — Stages defined by Max: four, not five (D-51). Evidence folds into
  intake, assembly folds into revision. New question Q-36 on the print-ready reference.
- **2026-09-09** — Q-35 answered: the stage drives escalation, not per-item marking
  (D-50). Moving on to defining the stages.
- **2026-09-09** — Intake continued. Missing information becomes "needs info", not
  fatal (D-47). EAD may be absent entirely (D-48). Intake fields stay editable
  (D-49). Two new open questions, Q-34 and Q-35.
- **2026-09-09** — v2 scoping resumed. Version names recorded (D-44). Q-1 answered:
  the EAD is authoritative, Prima is not, and Prima was never connected to anything
  (D-45, D-46).
- **2026-09-09** — File created. Seeded from the 09-04 archive, the 09-04 scoping
  session recovered from the local Codex log, the lab notes, and a verified read
  of both repos. Test suite run and confirmed at 750 passing.
