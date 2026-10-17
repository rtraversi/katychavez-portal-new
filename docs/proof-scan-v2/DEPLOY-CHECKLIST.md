# Proof Scan v2: deploy checklist (for Rob)

Do these in order. Dev first, always. Nothing here has been done yet.

## 0. Before anything

- [ ] Answer Q-13: which branch deploys Katy's portal. This branch contains all of
      `module/forms-page-reorg` plus `main` up to `556118c` (README section 3).
- [ ] Decide with Max what sits at the existing Proof Scan route while v2 is tested: v1.2
      (as on this branch) or the live HTML checker (README section 3, point 3).
- [ ] Confirm the environment variables v2 uses already exist in dev and production:
      `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `SSN_ENCRYPTION_KEY`
      (the same key that encrypts `clients.ssn_encrypted`). No new secrets are introduced.
- [ ] Run `npm test` (expect 995 passing) and, if Postgres is installed locally,
      `bash scripts/proof-scan-v2-dbcheck/run.sh` (expect 32/32 PASS).

## 1. The security fix (can go first, on its own)

- [ ] Apply `supabase/migrations/2000_proof_scan_security.sql` to **dev**.
- [ ] Check: with the anon key, `select * from proof_scans` returns nothing or is refused;
      with a Client-role login, the same; with a Paralegal login, scans are readable.
- [ ] Apply it to **production**. This closes a live exposure (SPECS.md section B).

## 2. The rest of the migrations, in this order

| Order | File | What it does |
|---|---|---|
| 1 | `1302_proof_scan_structured_results.sql` | v1.2: structured result columns on `proof_scans` |
| 2 | `1303_proof_scan_history_metadata.sql` | v1.2: history metadata and row-shape constraints |
| 3 | `2000_proof_scan_security.sql` | staff-only access (if not already applied in step 1) |
| 4 | `2001_proof_scan_v2_core.sql` | cases, people, documents, suggestions, sign-offs, Possible issues, suppressions; `proof_scans` gains case, stage, scope, rule-set version |
| 5 | `2002_proof_scan_v2_rules.sql` | versioned rules, package items, per-stage settings, change log |
| 6 | `2003_proof_scan_v2_seed.sql` | seeds DACA renewal (42 checks, 8 package items) and General (10 checks, no package items); safe to run twice |

- [ ] Apply all six to **dev**, in that order.
- [ ] `1626_package_builder.sql` also appears as "new" relative to `main`; it comes from
      `module/forms-page-reorg`. Check the dev ledger (`applied-dev.txt`) before applying it.
- [ ] Update `applied-dev.txt` / `applied-prod.txt` the way you normally do.

## 3. Smoke test on dev

- [ ] The existing Proof Scan page still saves a scan (the old and new rows must coexist in
      `proof_scans`).
- [ ] Proof Scan v2 appears in the sidebar for Owner, Attorney, Partner Attorney and
      Paralegal, and not for the Client role.
- [ ] Start a DACA renewal case, upload a real (redacted) EAD in Evidence Zero, approve,
      run Draft Review, Pre-flight and Physical Scan on a real redacted package. **This is
      the first time the real AI sees v2's prompts and schemas.** Expect to tune wording.
- [ ] Start a General case, go straight to Physical Scan with a real redacted AOS package.
- [ ] Reveal an SSN with the eye: confirm a row lands in `sensitive_field_audit`.
- [ ] Optional email: send one to a test address and read it.

## 4. Production

- [ ] Apply the same migrations to production, in the same order.
- [ ] Deploy the branch (or merge it into whatever deploys, per Q-13).
- [ ] Tell Max it is live. He tests on the live site next to the existing checker (D-88)
      and rewrites the placeholder wording after launch (D-87).

## 5. Later, after Max signs v2 off

- [ ] Remove the old checker (D-88, plan Batch 6).

## If something goes wrong

- `2000`: dropping the new policies would reopen the exposure. Fix forward instead.
- `2001` to `2003`: create new tables and add nullable columns to `proof_scans`. Rolling back
  means dropping the new tables and those columns; old rows are untouched. A case with
  stored reports cannot be deleted by design (triggers), so drop the triggers first if you
  need to clean up a test case.
- `1302` / `1303`: v1.2's columns and constraints on `proof_scans`; legacy rows stay valid.

## v2.0.2 (branch `proof-scan-v2.0.2`)

Apply the migration FIRST, then deploy. The code writes `general_rule`, `city_of_birth` and
`edition_notices`; before 2005 those writes fail.

- [ ] Confirm 1704 and 2000 to 2004 are applied (they are on production per the 10-09 notes).
- [ ] Apply `supabase/migrations/2005_proof_scan_v2_0_2.sql` to **dev**. It is idempotent.
- [ ] Check on dev:
      `select case_type, version, is_current from proof_scan_rule_sets order by 1, 2;`
      Each case type has a new current version (one above the previous current), the old one
      `is_current = false`.
      `select s.case_type, r.retired from proof_scan_rules r join proof_scan_rule_sets s on s.id = r.rule_set_id where s.is_current and r.rule_id = 'PS-103';`
      Both `true`.
      `\d proof_scan_people` shows `city_of_birth`; `\d form_editions` shows `edition_notices`.
- [ ] Apply the same file to **production**. Update `applied-dev.txt` / `applied-prod.txt`.
- [ ] Deploy from branch `proof-scan-v2.0.2` (by hand, as before).
- [ ] After deploy: in Proof Scan v2 > Rulebook press "Check USCIS editions now" once, so the
      accepted editions are read without waiting for Monday.
- Rollback: 2005 only adds nullable columns and a new rule-set version. To undo the rules,
  set the new version's `is_current` to false, then the old version's to true (one current
  version per case type is enforced, so in that order).

## v2.1 (branch `proof-scan-v2.1`, stacked on v2.0.2)

Merge #4 (v2.0.2) first. Then apply the migrations **in this order: 2005, then 2006**, then
deploy v2.1. The v2.1 code reads `aos_kind`, `proof_scan_clears` and the new rule columns;
before 2006 a case or a report will not open.

- [ ] `2005_proof_scan_v2_0_2.sql` applied (v2.0.2 steps above).
- [ ] Apply `supabase/migrations/2006_proof_scan_v2_1.sql` to **dev**. It is idempotent.
      **Never apply 2005 again after 2006**: 2005 rewrites the suggestion field list without the
      passport fields. If it happens, apply 2006 again.
- [ ] Check on dev:
      `select case_type, version, is_current from proof_scan_rule_sets where case_type = 'aos';`
      one row, version 1, current.
      `select scope, count(*) from proof_scan_rules r join proof_scan_rule_sets s on s.id = r.rule_set_id where s.case_type = 'aos' group by 1;`
      case_type 49, firm the same count as General's current firm-wide rules.
      `\d proof_scan_clears` and `\d proof_scan_answer_tally` exist; the tally has no case column.
- [ ] Apply 2006 to **production**. Update `applied-dev.txt` / `applied-prod.txt`.
- [ ] Deploy (by hand, as before). In Proof Scan v2 start an AOS case: the kind is asked.
- Rollback: 2006 adds nullable columns, two tables and a new rule set. To take AOS out, set the
  AOS rule set's `is_current` to false; existing DACA and General cases are untouched.
