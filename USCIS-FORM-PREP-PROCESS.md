# USCIS Form Preparation — Contributor Process

**Audience:** a contributor (working with their own Claude Code) preparing and loading
additional USCIS forms into the IurisIQ form-filler module.

**Read first:** `CLAUDE.md` (project rules), then this document. You do **not** need to read
`new-client-setup.md` or `DESIGN-SYSTEM.md` — this work touches no UI.

## Your scope, in one line

**Get forms and their migrations ready so they can be added to the portal. Nothing else.**

How forms are presented and used inside the portal — packages, the UI, the workflow staff follow —
is Rob's work, running in parallel. Don't design around it, don't wait on it, don't touch it.

The form-filler pipeline is already built and working end to end for seven forms. Your job is
**not** to build features. It is to extend the form library one form at a time, following the
established pattern exactly.

---

## 1. What already exists

Do not rebuild any of this.

| Piece | Where |
|---|---|
| **Your two commands** — prep a form, then check your work | `scripts/prep-form.js`, `scripts/validate-field-map.js` |
| Which columns a field map can pull from | `scripts/fill-sources.js` |
| Template normalizer (decrypt + strip XFA + stamp barcodes) | `scripts/normalize-form-template.js` |
| Field-map resolver (sources + transforms) | `functions/api/_form-fill.js` |
| Schema (`form_templates`, `form_packages`, `form_package_items`, `generated_forms`) | `supabase/migrations/1511_form_filler_schema.sql` |
| API routes (`/api/form-filler/*`) | `functions/api/form-filler-*.js`, registered in `_worker.js` |
| UI (matter → USCIS Forms tab, in-page editor) | `pages/clients/detail/`, `pages/draft-forms/` |

**Forms already done:** `g-28`, `g-1145`, `g-1450`, `i-765`, `i-765ws`, `i-821d`, `n-400`.

**Packages already defined:** DACA Renewal (`daca`), Naturalization (`naturalization`).

**Half-done — good next target:** **I-864**. The `joint_sponsor.*` party plumbing landed in
migration `1604-joint-sponsor.sql`, but the field map was never authored. That migration's header
says as much.

---

## 2. The work split — read this carefully

This is the single most important section. The pipeline splits at a clean seam:

**You produce text. You never touch live infrastructure.**

| Step | Who | Needs credentials? |
|---|---|---|
| Download source PDF from uscis.gov | You | No |
| `prep-form.js` — normalize, dump field semantics, scaffold the migration | You | No |
| Author the `1600-<formid>.sql` field map | You | No |
| `validate-field-map.js` — check it | You | No |
| Open PR | You | No |
| Review + merge | Rob | — |
| Re-normalize and upload template to R2 | **Rob** | Yes — R2 |
| Apply migrations to the database | **Rob** | Yes — Supabase |
| Deploy the Worker | **Rob** | Yes — Cloudflare |

You will **not** be given R2, Supabase, or Cloudflare credentials, and you do not need them.
`wrangler.toml` and `.env` are gitignored and hold per-client secrets — if a step seems to require
them, you have gone off-process. Stop and ask.

**Never run** `npx wrangler deploy`, `scripts/db-migrate.ps1`, or
`normalize-form-template.js --upload`.

### Access

- **GitHub access to this repo is already granted.** That is the only access you need or get.
- Work on a branch: **`module/uscis-forms-library`**. Per `CLAUDE.md`, never push to `master`.
- One PR per form, or one PR per small batch of related forms. Not one giant PR.

---

## 3. One-time setup

```bash
git clone https://github.com/rtraversi/iurisiq-portal-template.git
cd iurisiq-portal-template
git checkout -b module/uscis-forms-library
npm install
mkdir uscis-forms
```

`uscis-forms/` and `normalized/` are **gitignored on purpose** (~96MB and growing, and the PDFs are
freely re-downloadable). Never `git add -f` them.

**The only file you commit per form is the `1600-<formid>.sql` migration.** That is the entire
deliverable.

### Migration numbering — leave it alone

All field maps share the `1600-` prefix plus the form id (`1600-i864.sql`, `1600-i130.sql`) rather
than incrementing numbers, so 125+ forms don't consume the numeric range. `db-migrate.ps1`
string-sorts filenames and tracks them by exact filename, so they sort after the `15xx_` schema
work and are mutually independent.

A separate migration-consolidation effort is underway elsewhere in this repo. **The `1600-*` files
are explicitly excluded from it** and keep their current naming — don't renumber, merge, or
"tidy" them, and don't let a consolidation discussion elsewhere change what you do here.

---

## 4. Per-form loop

Repeat this for each form. One form = one complete pass. **Two commands do the mechanical work;
your actual job is the thinking in Step 3.**

### Step 1 — Get the source PDF

Download the official fillable PDF from <https://www.uscis.gov/forms/all-forms>. Save it to
`uscis-forms/<form-key>.pdf`.

**Form key convention:** lowercase, hyphenated, exactly as USCIS names it — `i-130`, `i-864`,
`i-485`, `g-1145`. This key is used for the filename, the R2 object key, and the
`form_templates.form_key` column. Get it right the first time.

### Step 2 — Run `prep-form`

```bash
node scripts/prep-form.js i-864
```

One command. It normalizes the PDF, dumps every field's meaning, and writes a complete starter
migration:

| Output | What it is |
|---|---|
| `normalized/i-864.pdf` | the clean fillable template |
| `normalized/i-864.fields.json` | field inventory (names + types) |
| `normalized/i-864.tooltips.tsv` | **field name → type → maxLength → USCIS's own description** |
| `supabase/migrations/1600-i864.sql` | scaffold with **every field already listed as `blank`** |

It also prints the source PDF's **SHA-256**, already written into the migration header. That hash
matters: Rob re-normalizes on his own machine before uploading to R2, and if his copy is a
different USCIS edition than the one you mapped, field names can differ and the map silently
misfires. The hash lets him confirm byte-identical source.

**Then open `normalized/i-864.pdf` and confirm:** no password prompt, fields are fillable and
hand-editable, barcodes render as real barcodes (not raw text like `I-864|04/01/24|7`). If any of
that fails, **stop and escalate** — do not author a map against a broken template.

`prep-form` never overwrites an existing migration unless you pass `--force`, so re-running it is
safe once you've started mapping.

### Step 3 — Fill in the map

This is the real work. Open `normalized/<key>.tooltips.tsv` beside
`supabase/migrations/1600-<formid>.sql` and change `"blank"` to a real source for every field that
should autofill. **You never type a field name** — they are all already there, in PDF order. That
removes the single worst failure mode in this module (a mistyped name silently fills nothing).

**Never guess what a field means from its name.** Every USCIS field carries its own authoritative
description, and that is what the `.tooltips.tsv` column holds — e.g.
`Part 1. Basis For Filing Affidavit of Support. Select 1. A. I am the petitioner.` Read it. Cross-
check the form's official instructions PDF for anything still ambiguous.

Also replace the four `TODO` placeholders in the header: the form description, the **edition date**
(printed lower-left on the PDF), the mapping-decisions notes, and the form's full official title.
The validator fails until all four are gone.

**For the header comment, follow `1600-n400.sql`** — it is the best-documented example. For the
simplest possible case, see `1600-i765ws.sql`.

**Every field keeps an entry** — either a real source or an explicit `"source": "blank"`. Explicit
blanks are documentation: they prove the field was considered, not overlooked. (Barcode fields are
already excluded — normalization removes them.)

#### Field map entry shape

```json
"form1[0].#subform[2].Pt2Line3_FamilyName[0]": {
  "type": "text",
  "source": "client.last_name",
  "transform": "state_abbrev"
}
```

- **`type`** — `text` | `checkbox` | `dropdown`. Must match the inventory's reported type.
- **`source`** — one of:

| Source prefix | Resolves to |
|---|---|
| `client.<col>` | the client record (the beneficiary on immigration matters) |
| `matter.<col>` | the matter record |
| `immigration.<col>` | `client_immigration` row |
| `immigration.family.<n>.<col>` | nth family member; missing member = silently blank |
| `petitioner.<col>` | `opposing_parties` row, `party_role='primary'` (the sponsoring petitioner) |
| `joint_sponsor.<col>` | `opposing_parties` row, `party_role='joint_sponsor'` (I-864) |
| `firm.<col>` | `firm_settings` singleton |
| `attorney.<col>` | the matter's assigned attorney (user record) |
| `literal:<value>` | a fixed value, e.g. `literal:United States` |
| `blank` | deliberately left empty |

  Special virtual columns: `client.ssn_full` / `petitioner.ssn_full` / `joint_sponsor.ssn_full`
  (decrypted at fill time), and `attorney.full_name` / `petitioner.full_name` /
  `joint_sponsor.full_name`.

#### Which columns actually exist

You have no database access, and the columns are spread across the base tables plus dozens of
later `ALTER TABLE ADD COLUMN` migrations. Don't guess — ask:

```bash
node scripts/fill-sources.js            # every fill source and its columns
node scripts/fill-sources.js client     # just one
```

It reads the migrations live, so it can't go stale. **A column you need but don't see there does
not exist yet** — leave the field `blank`, note it in the header as a candidate future column, and
escalate.

`validate-field-map.js` warns on a column that isn't in that list. Take those warnings seriously:
a misspelled column raises no error at runtime, it just silently fills nothing.

- **`transform`** (optional) — one of `state_abbrev`, `a_number`, `unit_number`, `unit_is_apt`,
  `unit_is_ste`, `unit_is_flr`, `yes_no`, `yes_no_invert`, `digits`, `date_mmddyyyy`, `date_slash`.
  See `applyTransform` in `functions/api/_form-fill.js` for exact behavior.

**If you need a transform that doesn't exist, or a data column that doesn't exist — stop and
escalate.** Do not add columns or transforms yourself; those are cross-cutting changes that affect
every form and belong to Rob. Write the entry as `blank`, note it in the header as a candidate
future column, and move on. (`1600-n400.sql`'s header does exactly this for "date became LPR".)

#### Hard rules on what never gets autofilled

These stay `blank`, always:

- **Signatures and signature dates** — of applicant, preparer, interpreter, or attorney.
- **Attestations and certifications** — the "I certify / I have read and understand" checkboxes.
- **Payment fields** — G-1450 card number, CVV, expiration, cardholder signature.
- **Narrative and case-strategy fields** — personal statements, explanations, eligibility-basis
  selections, waiver arguments. These are the attorney's professional judgment.
- **Biometrics, gender/sex, marital status** unless there is an unambiguous data column.

Anything the attorney must exercise judgment on is left for the attorney. When genuinely unsure
whether a field is data or judgment: **leave it blank and say so in the header.** A blank field is
a two-second fix in the editor; a wrong autofilled field on a filed immigration form is a serious
problem.

#### Unit-number checkboxes — a known trap

The Apt/Ste/Flr checkbox trio's index order is **not consistent** across forms, or even between
address blocks within a single form. Always confirm against the per-field tooltips. Do not
pattern-match from another form's map.

### Step 4 — Validate

```bash
node scripts/validate-field-map.js i-864
```

Second and last command. It fails the run (non-zero exit) on any of:

- a field name that isn't in the PDF
- a declared `type` that disagrees with the actual PDF field type
- an unknown source prefix or unknown transform
- a field type that can't autofill (RadioGroup / Signature / Button) given a non-blank source
- any leftover scaffold `TODO`

and warns on a PDF field missing from the map, or a signature-looking field with a non-blank
source.

Fix everything until it passes. It prints a ready-made counts line for your PR description.

**What it cannot check.** It validates the map's *shape* — that names, types, sources, columns, and
transforms are real. It cannot tell you whether you mapped the *right* column to the *right* box,
and you can't generate a filled PDF locally (that needs the database and R2, which are Rob's side
of the split). A green validator means "this will run," not "this is correct."

So the accuracy of the mapping rests on Step 3: read the tooltip for every field you fill, and when
a field is ambiguous, leave it blank and say so. Flag anything you were unsure about in the PR —
that list is the most useful thing you can hand a reviewer.

### Step 5 — Packages: not your scope right now

A form only reaches staff once it belongs to a **package** tied to a `case_types` row. Today a
package is predefined per case type — but that model is being redesigned, because a real filing
isn't always the same set of forms for a given case type.

**So: do not create or modify packages, and don't let package questions block you.** Author the
field map, open the PR, move to the next form. Rob wires packages up separately once the new model
lands.

This costs you nothing: **field maps are package-independent.** A map describes one form's fields
and doesn't know or care which packages include that form, so the redesign won't invalidate any
map you write. That's exactly why this work can run in parallel with it.

### Step 6 — Test suite

```bash
npm test
```

Per `CLAUDE.md`, this must be green before any merge. Your migrations shouldn't affect it, but a
red suite blocks the PR regardless — report it rather than working around it.

### Step 7 — Commit and PR

One form per commit. Message style, matching the existing history:

```
feat(forms): I-864 field map + Affidavit of Support template registration
```

**PR description must include:**

- Form key, full form name, **USCIS edition date**, and **SHA-256 of the source PDF** (both are
  already in the migration header — copy them up).
- The counts line printed by `validate-field-map.js`.
- Confirmation that `validate-field-map.js` passes, and that you reviewed any warnings.
- A short list of judgment calls — anything left blank that a reader might expect to be filled, and
  why.
- Anything escalated (missing columns, missing transforms, ambiguous fields).

---

## 5. Definition of done, per form

- [ ] Source PDF saved as `uscis-forms/<key>.pdf` using the correct form key
- [ ] `node scripts/prep-form.js <key>` run
- [ ] Normalized PDF opened and checked: fillable, no password, barcodes render as barcodes
- [ ] Tooltips consulted for every non-obvious field — no guessing from field names
- [ ] Every field either given a real source or left explicitly `blank`
- [ ] Column names checked against `node scripts/fill-sources.js` — not guessed
- [ ] All four header `TODO`s replaced, including the **edition date**
- [ ] Header documents the mapping decisions and anything escalated (`1600-n400.sql` style)
- [ ] `node scripts/validate-field-map.js <key>` passes; warnings reviewed
- [ ] `npm test` green
- [ ] Committed to `module/uscis-forms-library`, PR opened with the full description above

---

## 6. Escalate — don't improvise

Stop and ask Rob when you hit any of these:

- A needed **data column doesn't exist** on client / matter / immigration / petitioner / firm / attorney
- A needed **transform doesn't exist** in `_form-fill.js`
- The form **won't normalize**, or normalizes with 0 fields, or barcodes render as raw text
- The form needs a **new fill source** (a party type beyond petitioner / joint sponsor)
- Anything to do with **packages** — see Step 5; that model is being redesigned
- Anything that would require changing `_form-fill.js`, `_worker.js`, the schema, or any UI file

Those files are shared across every form. Changing them to make one form work is how this module
gets broken for the other seven.

---

## 7. Priority order

**Rob is supplying the form list and priority order — work from that, not from guesswork.** If you
don't have it yet, ask before starting; filing volume should drive the order, not form complexity.

One standing note: **I-864** is the natural first form regardless. Its `joint_sponsor.*` party
plumbing is already built and waiting (migration `1604-joint-sponsor.sql`), so it's the cheapest
real win in the library.
