# Proof Scan — Claude takeover

**Written:** 2026-09-25
**Purpose:** let Claude continue product scoping with the full durable context,
without treating historical documents or the current portal working tree as
instructions to implement.

## Read order

1. Read `PROOF-SCAN.md` completely. It is the master record and contains the
   current product decisions, architecture status, build status, ownership, and
   continuation queue.
2. Read `NOTES.md` for chronological context and the original user wording.
3. Read `RULES-LIVE.md` to distinguish the old live HTML checker's rules from
   Checker v1.2's structured DACA profile.
4. In `katychavez-portal-new`, read `PROOF-SCAN-README.md` before treating any
   `PROOF-SCAN-*.md` file as current. They are historical; the master record wins.
5. Only after the product record is understood, inspect the v1.2 implementation:
   `functions/api/proof-scan-profiles/daca-renewal.v1.json`,
   `functions/api/proof-scan-contract.js`, `functions/api/proof-scan.js`, and the
   corresponding tests.

## What exists

- **Checker v1.2:** a structured DACA final-package checker, built and tested locally
  in `katychavez-portal-new` on `codex/proof-scan-production`. It has four committed
  batches through `51aa67f`, plus uncommitted Batch 5 hardening and a Possible issues
  frontend shell. See `PROOF-SCAN.md` sections 1 and 5 for the verified snapshot.
- **Checker v2:** a staged oversight tool. Its product workflow is now scoped in
  `PROOF-SCAN.md` decisions D-52 through D-61. None of v2 is implemented.
- **Deployment:** nothing in this workstream is authorised for push, migration, or
  deployment. Rob owns the outstanding deployment and live-source questions.

## Current v2 operating model

- Evidence Zero: persistent, quiet document/fact workspace.
- Draft Review: stage-appropriate review of individual forms or a whole draft set.
- Pre-flight: optional proofing after signed documents and corrections.
- Physical Scan: the full v1.2-style final case-type checker on the prepared package.
- Possible issues: the only home for exploratory/learned ideas; separate from official
  findings and email.

The master record carries the exact boundaries, source-authority rules, reference
record rules, rulebook behavior, email policy, and prior decisions. Do not summarize
from memory or introduce legal requirements not supplied by Max/the firm.

## Conversation rules

- Product decisions belong to Max. Ask **one focused question at a time**.
- Let Max brainstorm; do not turn ideas into requirements until he confirms them.
- Explicitly distinguish a settled decision, open question, Max's words, and your
  own inference.
- Do not resurrect settled questions or broaden the task with speculative design.
- Do not code, push, deploy, apply migrations, contact external services, or disturb
  another active implementation session unless Max explicitly authorizes it.
- When a decision settles, append it to `PROOF-SCAN.md` and add a concise dated note
  to `NOTES.md`. Preserve prior decisions; record a superseding decision instead of
  rewriting history.

## Start here

After completing the reading above, ask only this question:

> With the v2 stage model settled, would you like to walk through the existing DACA
> v1.2 profile and confirm the exact Physical Scan form/evidence contract, starting
> from the firm's existing checklist rather than adding new requirements?

If Max chooses a different topic, follow his direction. The current open questions
are Q-44 through Q-47 in `PROOF-SCAN.md`.
