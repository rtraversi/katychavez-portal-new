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

## What is NOT done

- Never run against the real Anthropic API, the real Supabase, or a real PDF.
- Migrations not applied anywhere. Not deployed.
- Placeholder wording throughout (`pages/proof-scan-v2/copy.js`); Max rewrites after launch.
- Removing the old checker waits until Max signs v2 off.
