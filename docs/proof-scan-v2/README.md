# Proof Scan v2: handoff to Rob

**From:** Max (with Claude), 2026-10-08
**Branch:** `proof-scan-v2`. Nothing on any other branch was changed.
**Status:** built and tested locally. **Never deployed, no migration applied anywhere, never
run against the real AI.** Those three steps are yours.

---

## 1. What this is, in one paragraph

Proof Scan v2 replaces "one big final check" with a case that moves through four stages:
**Evidence Zero** (upload the EAD and other evidence; the AI reads the facts into case
cards), **Draft Review** (check drafts against those facts and the checklist), **Pre-flight**
(check the client's corrections, signatures and card details), and **Physical Scan** (the
full final check of the printed package). There are two case types: **DACA renewal** (the
firm's full checklist) and **General** (any case type without its own checklist yet: AOS,
PIP, I-90 and so on), which runs firm-wide checks only, the biggest one being **"the
evidence matches the forms"**. The AI only reports what it sees; the server decides every
result. v2 runs **next to** the existing checker while Max tests it on the live site.

## 2. Read in this order

1. **This file.**
2. [`DEPLOY-CHECKLIST.md`](DEPLOY-CHECKLIST.md): what you need to do, step by step.
3. [`BUILD-LOG.md`](BUILD-LOG.md): what was built, batch by batch, with commits.
4. [`DECISIONS-MASTER-RECORD.md`](DECISIONS-MASTER-RECORD.md): every product decision,
   D-1 to D-102, with Max's own words. **If anything disagrees with it, it wins.**
5. [`BUILD-PLAN.md`](BUILD-PLAN.md) and [`SPECS.md`](SPECS.md): the plan and the technical
   specs (security finding, rules as data, what the AI is asked and returns).
6. [`CLAUDE-START-HERE.md`](CLAUDE-START-HERE.md): paste-ready instructions for your Claude.
7. `history/`: the chronological notes, the old checker's rules, and the earlier takeover
   document. Background only.
8. `lab-mockup/`: the design mockup Max approved. Reference only; the real page is runnable
   (section 4).

## 3. Things you must know before touching anything

1. **Security problem on the live site today.** The existing Proof Scan tables
   (`proof_scans`, `proof_scan_config`) have row policies of `USING (true)` with no role,
   so the public anon key and client logins can likely read, change or delete every saved
   scan report and the Proof Scan settings. Migration `2000` fixes it. It can be applied on
   its own, ahead of everything else, and should be. Details: `SPECS.md` section B.
2. **What this branch is built on.** `proof-scan-v2` contains **all of
   `module/forms-page-reorg`** (Package Builder, Template Defaults, etc., checked
   2026-10-08: nothing on that branch is missing here) **plus everything on `main`** up to
   `556118c`, plus the Proof Scan work. If production deploys from
   `module/forms-page-reorg` (open question Q-13), compare and merge against that, not `main`.
3. **The "current checker" on this branch is v1.2, not the live HTML checker.** v1.2 is the
   structured DACA checker built in early September (never deployed). On this branch it sits
   at the existing Proof Scan route, and v2 is a second sidebar entry ("Proof Scan v2").
   Deploying the branch as-is therefore replaces the live HTML checker with v1.2. Max must
   confirm whether that is wanted, or whether the live HTML checker should be restored at
   that route while v2 is tested (decision D-88 says "v2 next to the old checker").
4. **Nothing has met reality yet.** No real PDF has gone through v2, the AI prompts and
   schemas have only seen mocked answers, and the routes have never run against the real
   Supabase. The database migrations were tested on a local Postgres 16 (see the checklist).

## 4. See it running in 30 seconds

```bash
npm install
npm run preview:proof-scan-v2
```

Then open http://127.0.0.1:8788/ . This is the **real page and the real server logic**
against an in-memory database; only the AI is replaced with canned, synthetic answers. Three
cases are ready: a DACA renewal through all four stages, a General AOS-style case with two
people, and a DACA case partway through. Restarting resets everything.

## 5. Tests

```bash
npm test                                  # 995 tests, all passing on 2026-10-08
bash scripts/proof-scan-v2-dbcheck/run.sh # 32 database checks on a throwaway local Postgres
```

`run.sh` needs Postgres installed locally (`brew install postgresql@16`). It creates a
fresh database, applies a small Supabase shim plus the migrations, runs every check,
prints PASS/FAIL, and drops the database. It never connects to dev or production.

## 6. Open questions only you can answer

- **Q-13 / Q-33:** which branch and repo actually deploy Katy's portal.
- **Q-28:** the model. v2 uses `claude-sonnet-4-6`, same as v1.2.
- **Data terms:** v2 sends EADs and full SSNs to the Anthropic API (so does the live checker,
  inside the PDF). Check whether the firm's account keeps them and whether zero data
  retention is available.
- **Q-30:** whether `notify_email` is set on the live portal. The old checker emails it on
  every scan.
- **Q-32:** cost. v2 makes one AI call per stage run plus one per Evidence Zero document;
  rough estimate $0.40 to $0.90 per DACA case (unverified).
- **Email wording:** v2's optional email leaves out the client and case name, so staff cannot
  tell which case it is about. Max has not decided whether to include the client name.
