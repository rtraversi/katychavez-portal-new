# NC estate-planning starter templates

`build-nc-starter-templates.mjs` builds the Word (.docx) starter templates that the
estate-planning module installs for a firm (`POST /api/ep-intake/install-starters`).
They are filled with docxtemplater (`{{ }}` delimiters, `paragraphLoop`, `linebreaks`)
against the placeholder contract in `functions/api/_ep-merge-context.js`.

| Key | Document | Source | Statutory |
|---|---|---|---|
| `nc_hcpoa` | Health Care Power of Attorney | G.S. 32A-25.1(a): https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_32A/GS_32A-25.1.html | yes |
| `nc_living_will` | Advance Directive for a Natural Death ("Living Will") | G.S. 90-321(d1), the form as amended by S.L. 2007-502: https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_90/GS_90-321.html | yes |
| `nc_poa` | Statutory Short Form Power of Attorney, with the Important Information for Agent page | G.S. 32C-3-301: https://www.ncleg.gov/EnactedLegislation/Statutes/HTML/BySection/Chapter_32C/GS_32C-3-301.html | yes |
| `nc_hipaa` | HIPAA Authorization | Drafted to contain the core elements of 45 CFR 164.508(c) | **no: attorney review required** |

All three statutes were fetched on 2026-11-04. The form text is copied word for word:
nothing is paraphrased or modernized, including the statute's own quirks, such as the
old `nclifelinks.org` registry URL and "Advance" vs. "Advanced" Health Care Directive
Registry. The layout follows the statute but isn't identical to it: the initials blocks
and the health care agent blocks are borderless tables, so the text wraps in its own
column. The quotation marks that G.S. 32C-3-301 puts around its form belong to the
statute, so the template leaves them out.

## What gets filled, and what never does

- **Filled:** the principal's name, and each agent's name, address and phone
  (`hc_agent_1..3_*` for the health care POA, `poa_agent_1..3_*` for the agent and the two
  successor agents on the financial POA). The HIPAA form also fills the date of birth,
  the address, the health care agents, and `hipaa_people_list`. A missing value prints as
  `__________`.
- **Never filled:** every initials line and choice, the physician blanks, Additional
  Provisions / special instructions, and the signature, witness and notary blocks. On the
  NC living will and the statutory POA, the principal initials each choice **by hand at
  signing**. That handwritten initialing is how the forms record the principal's own
  decisions, and pre-printing it would undercut that, along with the execution formalities
  around it. The client's questionnaire answers to those questions are shown to the attorney
  instead, so the attorney can go over them with the client at the signing.

## Wills and trusts

Wills and trusts are not statutory forms, so they are not built by this script. They are
built by `build-plan-templates.mjs` from `scripts/ep/src/*.md`: an NC pour-over will
(`nc_pour_over_will`) and a single-grantor revocable living trust (`nc_revocable_trust`).
These are drafts, made from Google Docs drafted 2026-11-04. They are not a firm's own
forms, and they need attorney review before first use. They fill in names, addresses,
county, family, fiduciaries, the distribution age and Schedule B gifts. Every
`[BRACKETED]` drafting choice is left for the attorney. A firm's own will/trust templates
go in through Settings → Word Templates, with "Fills from" set to Estate planning
questionnaire.

```
node scripts/ep/build-plan-templates.mjs     # build + verify → functions/api/_ep-plan-templates.js
```

## Rebuilding

```
node scripts/ep/build-nc-starter-templates.mjs                  # build + verify
node scripts/ep/build-nc-starter-templates.mjs --check-source   # also re-fetch ncleg.gov and diff the wording
```

The script writes `scripts/ep/out/<key>.docx` (gitignored; open these in Word),
`scripts/ep/out/<key>.filled.docx` (rendered against a fake, fully populated client so
you can check it by eye), and `functions/api/_ep-starter-templates.js` (generated; commit
it, and don't hand-edit it). The build is deterministic, so the module only changes when
the templates do.

The build exits non-zero if any check fails. The checks:

- every `{{tag}}` sits inside one Word run, and every tag is a key in `contextKeys()`
- the fixture render throws no errors, leaves no `{{`, contains the fixture's names,
  addresses and phones, prints no `__________` fallback for a filled field, and leaves
  every `(Initial)` / `(_____)` line untouched
- an empty context (`buildEstateContext({})`) renders without errors
- with `--check-source`, the template's words, minus placeholders and blanks, match the
  live statute word for word

To change a statutory template, edit its DSL block in the script (the layout markers are
documented in its header comment). Then run with `--check-source` to confirm the wording
still matches the statute.
