# For Rob's Claude: start here

Paste this into Claude Code from the repo root, on branch `proof-scan-v2`:

```text
You are taking over Proof Scan v2 in this repo, on branch proof-scan-v2.

Read, in this order, before doing anything:
1. docs/proof-scan-v2/README.md
2. docs/proof-scan-v2/DEPLOY-CHECKLIST.md
3. docs/proof-scan-v2/BUILD-LOG.md
4. docs/proof-scan-v2/DECISIONS-MASTER-RECORD.md (D-1 to D-102 are settled product
   decisions by Max; they win over anything else, including your own preferences)
5. docs/proof-scan-v2/SPECS.md and docs/proof-scan-v2/BUILD-PLAN.md

Ground rules:
- Product decisions are Max's. Do not change a settled decision; if something looks wrong,
  say so and ask Rob to check with Max.
- Do not invent immigration requirements, evidence categories or rule severities. The rules
  come from the firm.
- The AI only reports observations; the server decides every result (D-18). Keep it that way.
- Never put real client data in tests, fixtures or the preview.
- The Proof Scan tables must stay staff-only (migration 2000).
- Dev before production, always. Do not push to main or deploy unless Rob says so.

Then help Rob work through DEPLOY-CHECKLIST.md, starting with the security fix. Expect the
first real AI runs on redacted packages in dev to need prompt and wording adjustments;
the schemas and server logic are covered by 995 tests and 32 database checks, the real
model is not.
```

Useful commands:

```bash
npm test                                   # 995 tests
npm run preview:proof-scan-v2              # real page + real server logic, canned AI, http://127.0.0.1:8788/
bash scripts/proof-scan-v2-dbcheck/run.sh  # migrations on a throwaway local Postgres (brew install postgresql@16)
```
