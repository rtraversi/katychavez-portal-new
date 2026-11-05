# Estate Planning — client questionnaire, answers, drafting

**Branch:** `module/ep-intake` (off master) · **Migrations:** `2300_estate_planning_intake.sql`, `2301_matter_additional_case_types.sql` (range 2300–2399, free in both repos)
**Status 2026-11-04:** built, `npm test` green (933). **Not yet applied to the sandbox DB, not deployed, not click-tested.**
First client: KCL (Katy, NC wills & trusts) — built here, cherry-picked there per the two-repo workflow.

Not to be confused with the unmerged `module/estate-planning` branch (Aug: jurisdiction model + Lookback/fin)
or `module/intake-builder` (July: generic forms-as-data engine). This module is deliberately standalone:
it inserts the same `estate_planning` practice-area and case-type keys as that branch's 2101, idempotently,
so the two converge if both ever land.

## What it does

1. **Send.** On the client card → **Estate Planning** tab, staff send the questionnaire (English or Spanish),
   emailed and/or as a link to copy (for text/WhatsApp — shown once; only its SHA-256 is stored).
   Resending revokes the open link and **carries the client's saved progress** to the new one. Links last 60 days.
   **Or fill it in yourself** (phone / office meeting): the same questionnaire opens on the card, pre-filled from
   the client record (or the open link's saved progress). Saving makes it a submitted questionnaire with no link
   (`POST /api/ep-intake/enter`; closes any open link). Such rows are marked by `token_hash = 'staff:' + hex`
   (`isStaffEntered()` in `_ep-common.js`) — no migration; shown as "Entered by staff", never "New".
2. **Client fills it in** at `/estate-intake?t=…` — no login, one section per step, EN/ES toggle, autosave on
   every step and every 15 s, review page, Turnstile on submit. Hidden sections (e.g. spouse when single) are
   dropped on submit. Mobile-first, Docket kit, light/dark.
3. **Answers on the card.** Read in the questionnaire's own labels, **edit** (validated by the same definition,
   missing required answers are warnings for staff), **print**, and "show what the client submitted" — the
   original submission is frozen (`answers_submitted`); drafting reads the working copy (`answers`).
   Staff are emailed on submit (assigned attorney + sender) — names only, never answers.
4. **Draft.** Pick templates, for the client or (couples) the spouse → filled `.docx` in `draft_documents`
   (same tables/R2 keys/versions/WebDAV as Word Templates) → **Open in Word**.
5. **Estate Planning page** (`#estate-planning`): ready-to-review and waiting-on-client lists across matters.

## Multiple case types per matter (2301)

An estate plan is a bundle, so a matter now has a **primary** case type (`matters.case_type_id`, unchanged — every
existing consumer keeps reading it) plus **"Also includes"** (`matters.additional_case_type_ids uuid[]`), picked with
`js/case-type-picker.js` (global `CaseTypePicker`) on the New Client form and the card's Case edit: a select-looking
button that opens a checklist, chosen types listed as chips underneath — first = **Primary**, any chip can be made
primary or removed. Generic across practice areas. Shown as "Simple Will · Irrevocable Trust · …" in
the card header, the Case section and the client list. Case-type hard delete counts it as in use. 2301 also adds the
seven estate case types 2300 didn't seed (irrevocable, asset protection, special needs, charitable, trust funding,
business succession, beneficiary review) and widens installed estate templates to all of them.

## Templates

| Key | What | Source |
|---|---|---|
| `nc_pour_over_will` | Pour-over will + self-proving affidavit (§31-11.6) | Google Doc drafted 2026-11-04 |
| `nc_revocable_trust` | Single-grantor revocable trust + Schedules A/B | Google Doc drafted 2026-11-04 (notes + Part III dropped) |
| `nc_hcpoa` | Health Care POA, G.S. 32A-25.1 | statute text, verified word-for-word |
| `nc_living_will` | Advance Directive for a Natural Death, G.S. 90-321(d1) | statute text, verified |
| `nc_poa` | Statutory Short Form POA, G.S. 32C-3-301 | statute text, verified |
| `nc_hipaa` | HIPAA authorization (not statutory) | drafted to 45 CFR 164.508(c) |

Installed per firm with **Install starter forms** on the tab. Firm-owned templates: Settings → Word Templates →
New → *Fills from: Estate planning questionnaire*. Rules the templates follow (see `scripts/ep/README.md`):
- Fill **facts** only (names, addresses, county, family, fiduciaries, age, gifts). `[BRACKETED]` drafting choices
  stay for the attorney. Statutory initials/choices are **never** pre-filled — the principal initials by hand.
- Missing answers print `__________`, never an empty string.
- Placeholder contract: header of `functions/api/_ep-merge-context.js`. Builders fail on any unknown tag.

## Files

- `functions/api/_ep-questionnaire.js` — the bilingual NC definition (the only file with questionnaire wording)
- `functions/api/_ep-validate.js` — builds stored answers from the definition; visibility; required checks
- `functions/api/_ep-merge-context.js` — answers → template context (incl. reciprocal spouse swap)
- `functions/api/_ep-common.js` — tokens, staff auth, constants
- `functions/api/ep-intake-public.js` — public load / save / submit (+ `?preview=1`)
- `functions/api/ep-intake-staff.js` — send / matter / answers / revoke
- `functions/api/ep-draft.js` — templates / install-starters / draft
- `estate-intake.html` + `js/ep-intake.js` — the public page
- `pages/clients/detail/estate-planning.js` — the card tab (detail.js only carries `initEstateTab()`)
- `pages/estate-planning/` — overview page; `modules/registry.js` entry
- `scripts/ep/` — template builders + sources; generated `_ep-starter-templates.js`, `_ep-plan-templates.js`
- Shared files touched (small): `_worker.js`, `_notifications.js` (+2 emails), `drafting-generate.js` (refuses
  estate templates), `word-templates.js` (Fills-from), `detail.js`/`index.html` (tab hook), `css/portal.css`
  (commented `.ep-*` kit extension), `template-neutrality.test.js` (one documented place-name exception: Madison County)

## To go live (sandbox first)

1. Apply `2300` to the sandbox DB; record it in `applied-dev.txt` as its **own** commit.
2. Deploy the sandbox; Owner → Settings → Permissions shows **Estate Planning**; module is enabled by the migration.
3. Click-test: new client (practice area Estate Planning) → tab → Preview → Send (EN and ES) → fill on a phone,
   leave and come back → submit → staff email → edit answers → Install starter forms → draft will + POA, client
   and spouse → Open in Word. **Light and dark.**
4. Cherry-pick to KCL (`module/ai-chat` is the deploy branch). Expect small conflicts in `_worker.js`,
   `detail.js`, `registry.js`. Apply 2300 to KCL with `-File` (it's production). Rob deploys.

## Open — for Katy / Rob

- **Katy must review every template** before a client signs one — the will and trust are AI-drafted, not her forms.
- **Spanish** copy is a first draft — a native-speaker read before clients see it.
- The tab shows on **every** matter while the module is on (a card holds one matter; existing immigration clients
  who want a will need it). Flip to estate-matters-only in `initEstateTab()` if that's too noisy.
- Trust template is single-grantor; couples need a joint/paired redraft (Katy's call).
- Client document upload inside the questionnaire (deeds, old wills) — not built; existing portal upload covers it for now.
- `PORTAL_URL` must be set on the worker or links fall back to the request origin.
