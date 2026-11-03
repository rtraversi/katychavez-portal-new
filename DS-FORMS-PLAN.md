# DS-160 / DS-260 — Consular Forms Plan

**Status:** 📋 Roadmap — not started. No branch, no migration number reserved.
**Trigger:** the `consular_processing` and `nonimmigrant_visa` case types are already seeded
(migration `007_practice_areas.sql`) but have no form support. Every consular matter currently
falls out of the portal at the CEAC step and gets keyed by hand.

---

## Why

The USCIS side of a family-based matter is covered — I-130, I-130A, I-485, I-864, G-28 all fill
from the matter. Then the case goes to NVC or a consulate and everything stops. Staff re-key the
same client data into CEAC by hand, twice for a consular case (DS-260 per applicant), and there's
no record in the portal of what was submitted.

This is the highest-volume manual data entry left in the immigration workflow, and it's the one
the form-filler module was supposed to eliminate.

---

## The one fact that shapes everything

**DS-160 and DS-260 are not PDFs.** They are online-only applications on CEAC
(`ceac.state.gov`). State does not publish a fillable PDF for either, and there is no accepted
paper filing path. So **the entire `functions/api/_form-fill.js` pipeline does not apply here** —
no AcroForm template, no `field_map`, no `prep-form`, no `normalize-form-template`. Nothing from
`USCIS-FORM-PREP-PROCESS.md` carries over except the discipline.

**The saved-application `.dat` file is a dead end.** CEAC lets an applicant save progress to a
`.dat` file and re-upload it later, which looks like an ideal generation target. It isn't: the
format is opaque and documented by State as unreadable outside the DS-160 application itself.
Generating one would mean reverse-engineering an undocumented upload format for a federal system —
legally dicey, and it would break silently the first time State changes it. **Ruled out. Do not
revisit without a specific reason.**

That leaves two viable shapes, below.

---

## The real cost is the data model, not the fill

This is the part to internalize before estimating anything.

`client_immigration` today is ~15 columns: `a_number`, `visa_category`, `priority_date`,
`receipt_number`, `petitioner_name`, `beneficiary_name`, `nationality`, `country_of_birth`,
`last_entry_date`, `authorized_stay_until`, `country_of_citizenship`, `languages`,
`uscis_account_number`.

DS-160 asks roughly 80 questions. DS-260 asks more. The large majority of that answer surface has
**nowhere to live in our schema today**:

- Address history (5 years, with dates)
- Travel history / every prior US visit, with dates and visa details
- Full work and education history
- Passport history, including lost/stolen passports
- Social media handles (DS-160 requires these)
- The security & background questions (three long pages of yes/no with conditional explanations)
- Per-applicant data for each derivative — DS-260 is filed **per person**, not per case

So the fill mechanism is maybe 30% of this. **The bulk of the work is schema + an intake surface
to collect it.** Any estimate that skips that is wrong.

Corollary: this shares almost all of its data with a well-built I-485/N-400 intake. Design the
schema for both, not just for DS.

---

## Two delivery shapes

### Option A — CEAC autofill (bookmarklet or extension)

A script that reads matter data from the portal and drives the live CEAC page. This is what
Fillvisa OS does for DS-160, so it is demonstrably possible.

- **Pro:** actual autofill, real time saved, no re-keying.
- **Con:** fragile. It's DOM-coupled to a government site we don't control and can't stage
  against. CEAC is ASP.NET WebForms with postback-per-page and a session timeout; a bookmarklet
  has to walk the page sequence, not blast one form. Expect it to break without notice.
- **Con:** DS-260 is behind an NVC login with a case number, and is per-applicant. Harder than
  DS-160 and can't be tested without a live case.
- **Con:** needs a maintenance owner. A broken autofill that silently mis-keys a security question
  is worse than no autofill.

### Option B — Structured worksheet export

Generate a print/PDF worksheet containing every CEAC answer, in CEAC's exact question order and
wording, populated from the matter. Staff keep it beside the browser and key from it.

- **Pro:** cannot break. No coupling to State's markup at all.
- **Pro:** doubles as the client-facing questionnaire and as the file copy of what was submitted —
  which we don't have today at all.
- **Pro:** reuses the existing doc-generation path rather than inventing a new one.
- **Con:** doesn't eliminate the typing, only the lookup and the re-derivation.

**Recommendation: B first, then A on top of B.** B requires the schema work that A also requires,
delivers value on its own, is safe, and turns A into a purely mechanical add-on once the data
exists. Building A first means building the fragile half against data we haven't modeled yet.

---

## Suggested phasing

1. **Schema.** Model the DS answer surface — address/travel/work/education history, passport
   history, security questions, per-applicant records. Migration in the immigration range. Design
   it to serve I-485/N-400 too.
2. **Intake surface.** Extend the immigration intake so this is collectible — ideally client-fillable,
   reusing the Send Intake token flow (`SEND-INTAKE-PLAN.md`) so the client does the typing.
3. **DS-160 worksheet.** Option B for the nonimmigrant form. Ships value.
4. **DS-260 worksheet.** Per-applicant, including derivatives.
5. **Proof-scan rules for DS answers.** Completeness and internal-consistency checks (address gaps,
   travel history vs. entry dates, unexplained yes-answers). The existing proof-scan job structure
   applies even though the artifact isn't a PDF.
6. **CEAC autofill.** Option A, only if steps 1–5 are solid and someone owns the maintenance.

---

## Open — needs Rob's call

- **Is DS-260 in scope, or DS-160 only?** DS-260 is the one that pairs with our existing I-130
  work (consular processing), so it's arguably the more valuable of the two despite being harder.
- **Who fills the history sections — client or staff?** Decides whether step 2 is a portal page or
  a public intake link. Strong lean: client, via Send Intake.
- **Premium module, or fold into `draft_forms`?** DS forms don't use the form-filler pipeline at
  all, which argues for a separate `consular_forms` module key rather than overloading
  `draft_forms`.
- **Is anyone going to own the autofill's maintenance?** If no, stop at Option B and say so
  openly rather than shipping A and letting it rot.

---

## Licensing note

Fillvisa OS (`github.com/athos2113/fillvisa-os`) has a working DS-160 flow and CEAC bookmarklet,
and is **AGPL-3.0**. AGPL is viral over a network service — this portal is hosted, so pulling any
of their code in would reach our whole codebase. **Use it as an existence proof and a question-order
reference only. Copy nothing.** If we build the autofill, it gets built clean.
