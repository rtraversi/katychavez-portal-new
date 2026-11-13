# Bea-Bot — status and handoff

**As of:** 2026-11-13
**Branch:** `module/bea-bot` (off `main`, in `rtraversi/katychavez-portal-new`)
**Spec:** `BUILD_SPEC_daily_priority_brief.md` · **Plan:** `BEA-BOT-PLAN.md`
**Worked by:** Max, with Claude

Read `BEA-BOT-PLAN.md` first for *what* is being built and why. This file is *where it
actually stands*, and is written so someone else can pick it up cold.

---

## One paragraph

Bea (the Legal Beagle) is a Telegram bot that logs the firm's staff group, and a morning
job that turns the last day of that chat plus the monday.com boards into a short brief of
what needs Katy's attention. Phase 1 ships in four slices. **Slice 0 is live and logging.
Slice 1a (gather the context) is done. Everything beyond that is blocked on credentials,
not on code.**

---

## Where it runs right now

Everything below is a **test** environment. Nothing has touched Katy's production portal.

| | |
|---|---|
| Bot | `@BeaLegalBot`, created by Max in @BotFather |
| Group privacy | **Disabled** — confirmed via `getMe` → `can_read_all_group_messages: true` |
| Staff group | chat id `-1004480289705`, type `supergroup` |
| Worker | `bea-bot-test.shy-union-b269.workers.dev` |
| Cloudflare account | `2809122619f6ccd79e32edeb6e98504c` (Rob@builtsmartbyrob.com's) |
| R2 | bucket `iurisiq-sandbox`, objects under `bea-bot/` |
| Database | `https://uvmipihdgroswktkkhcv.supabase.co` — a **free project Max created**, not the firm's |
| Webhook | registered, `allowed_updates: [message, edited_message]`, 0 pending, no errors |

The test Worker is **not** `_worker.js`. It is a one-route harness in `.bea-test/`
(gitignored) that imports the real handler, because deploying `_worker.js` uploads the
whole repo as static assets. `.bea-test/worker.js` also exposes `POST /run-brief`, gated on
the webhook secret, to trigger the morning job by hand.

### Secrets

Held in files on Max's machine, `chmod 600`, and pushed to the Worker with
`wrangler secret put`. Never printed, never committed.

```
~/.bea-token            TELEGRAM_BOT_TOKEN       (from @BotFather)
~/.bea-webhook-secret   TELEGRAM_WEBHOOK_SECRET  (openssl rand -hex 32)
~/.bea-supabase-key     SUPABASE_SERVICE_KEY     (sb_secret_… from the test project)
```

---

## What is built

| Slice | What | State |
|---|---|---|
| **0** | Bea logs the staff group, sends nothing | **live, verified against real traffic** |
| **1a** | Daily job gathers context → `brief_log`, generates nothing | **built, verified live** |
| 1b | monday.com board diff | not started — needs a read token |
| 2 | Send the brief; Katy replies and the list updates | not started |
| 3 | Portal page | not started — needs production access |

### Files

```
functions/api/telegram-webhook.js        Slice 0. The webhook.
functions/api/process-daily-brief.js     Slice 1. Orchestrator + the Claude call.
functions/api/_brief-context.js          Slice 1. Pure context assembly.
functions/api/_prompts/daily-brief.js    The editable rubric. Katy owns this text.
supabase/migrations/2000_bea_bot_tg_messages.sql
supabase/migrations/2001_daily_brief_items.sql
supabase/migrations/2002_daily_brief_log.sql
test/unit/telegram-webhook.test.js       13 tests
test/unit/brief-context.test.js          11 tests
```

Registered in `_worker.js`: routes `/api/telegram-webhook` and `/api/process-daily-brief`,
plus an hourly cron branch. `wrangler.toml` crons now read
`["0 14 * * *", "*/5 * * * *", "0 * * * *"]`.

### Migrations

**2000, 2001 and 2002 are applied to the TEST database only.** Production has none of them.
All three are idempotent (`CREATE TABLE IF NOT EXISTS` throughout), so re-running them is
safe.

---

## Verified, and not

**Verified live, against the real staff group:**

- 34 messages logged across 3 senders in a 24-hour window
- Voice notes logged with `text: null` rather than dropped
- Edits update in place — `sent_at` preserved, `edited_at` stamped, **zero duplicate `message_id`s**
- 2 photos downloaded to R2 and confirmed retrievable by key
- `message_thread_id` and `reply_to_message_id` captured
- The gather half: `brief_log` row written with `sent_at: NULL` and a correct `input_summary`
- `why_katy NOT NULL` rejects an insert with no reason

**Never exercised:**

- **The Claude call.** Written, never run. No API key reachable from this branch. The first
  real run needs watching: structured output via `output_config.format` (not the deprecated
  `output_format`), no forced `tool_choice` (returns 400 on current models), and
  `stop_reason: "refusal"` checked before reading content.
- monday.com — adapter not merged, no token
- Sending anything to anybody
- The portal page
- Wrong-chat rejection and bad-secret rejection — unit-tested only, not against the live API

`npm test`: **355 passing, 26 files.**

---

## Decisions that depart from the spec

Each is argued where it lives; summarised here so nobody re-opens them by accident.

| Decision | Why |
|---|---|
| **5-item cap enforced in code**, after the model answers | The spec asks the prompt for "no more than 5". A prompt is a request; code is a guarantee. |
| **Hourly cron, gated on a configured local hour** | Cron is UTC and cannot express "9am wherever Katy is". She is often in Querétaro, which has no DST, so a fixed expression is right there and an hour out for US Central half the year. |
| **`priority_items` as its own table**, not an extension of `public.tasks` | The plan argued for extending `tasks`, and that is still better. Blocked by access: the brief has to be built against a database without the portal's schema. **Revisit in production** with a nullable `task_id` FK. Until then the risk the plan named is real — Katy closing something in Tasks while Bea keeps asking. |
| **`times_asked` + a three-strikes stop** (beyond the spec) | "Ask about items still open from yesterday" has no stopping condition, so the trailing list grows into exactly the noise that got monday.com's agents dropped. Flagged for Katy in the review doc. |
| **`why_katy` is NOT NULL** | Same reasoning as the item cap. |
| **`sent_at` nullable on `brief_log`; NULL means not delivered** | This *is* the silent week. Slice 1 generates and never sends, so Katy can read a week before any of it reaches her phone. |
| **`message_thread_id` stored** | Found in the real update queue, absent from the first fixtures. It is Telegram's own conversation grouping, and Phase 2 has to reconstruct conversations from this log. |
| **RLS on, no policy at all** on all three tables | They hold the staff chat verbatim — client names, A-numbers, case facts. The Worker uses the service role, which bypasses RLS. Slice 3 adds a read policy gated on `public.can_read('daily_brief')`. |
| **The webhook is not in `RATE_LIMITS`** | Telegram redelivers anything it does not get a 2xx for. A 429 there loses staff messages permanently. Same reason a failed write returns 500 rather than swallowing it. |

---

## Blocked on

### Rob, or whoever holds the accounts

1. **Access to the Cloudflare account that owns `katychavez-portal-new`** — account
   `463b69ce…`, which also holds the `katychavez-portal` R2 bucket. Max's token reaches
   Rob@builtsmartbyrob.com's account and Solarsaiko@gmail.com's; the Worker is in neither.
   Better asked as "add me permanently" than "deploy this for me".
2. **Access to the Supabase project "Katy Chavez Law"** (shorthand `KCL`, ref
   `syqpooenhygbkedfthwe` — the mapping is in `deploy/README.md`), or Rob applies migrations
   2000–2002 to prod himself. He deploys from `C:\Sites\katychavez`.
3. **Finish or merge `origin/module/monday-sync`** — a read-only adapter with pagination and
   pinned columns already exists there, unmerged. Slice 1b should reuse it, not rewrite it.

### Katy

1. **An Anthropic API key**, or permission for Max to create one. *This is the single
   highest-value unblock* — it is all that stands between Slice 1a and a real brief.
2. **A monday.com read-only token.** Slice 1b only.
3. **Send Bea a direct message once**, so her private chat ID can be captured. Slice 2
   cannot DM her without it.
4. Four decisions, all put to her in the review doc: is the five-level ranking in the right
   order · how long to keep messages and photos · any other staff channels later · the
   "FYI / delegate" line in or out.
5. On board `2468110147`, confirm `date3` is the deadline column.

**The staff have been told the group is logged.** Done 2026-11-13.

---

## Picking this up on a Mac

Local quirks worth knowing before you lose an hour to them:

- **`node_modules` is not in the worktree.** `npm ci` fails because `~/.npm/_cacache` has
  root-owned files from an old npm bug. Work around it rather than `sudo chown`:
  ```
  npm ci --cache /tmp/npm-cache-bea
  ```
- **Run vitest as `./node_modules/.bin/vitest`.** Plain `npx vitest` tries to fetch a
  different version from the network and hits the same cache problem.
- **`pwsh` is not installed**, so `scripts/db-migrate.ps1` and `scripts/deploy.ps1` do not
  run here. `deploy.ps1 -Prod` is only
  `node scripts/build-config.js && npx wrangler deploy`, which works fine directly. For
  migrations, paste the SQL into the Supabase SQL editor — but note `applied-prod.txt` is
  `db-migrate.ps1`'s source of truth and says not to hand-edit it, so prod migrations are
  better left to that script.
- **`wrangler.toml` is tracked by git**, although `CLAUDE.md` says it is gitignored. One of
  the two is wrong. It matters because per-client values committed there are visible to
  anyone with repo access.
- Deploy the test harness with:
  ```
  cd .bea-test && CLOUDFLARE_ACCOUNT_ID=2809122619f6ccd79e32edeb6e98504c npx wrangler deploy
  ```

---

## Next move

Get the Anthropic key. Then `process-daily-brief.js` runs its Claude call for the first
time, Slice 1 is complete, and the silent week starts — a brief written every morning that
nobody receives, until Katy has read a week of them and said which ones were worth having.
