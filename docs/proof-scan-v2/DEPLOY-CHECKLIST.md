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
