# Bea-Bot — Daily Priority Brief, Phase 1 build plan

**Spec:** `BUILD_SPEC_daily_priority_brief.md` (Katy Chavez, Nov 2026)
**This document:** Section 0 step 3 — "give a short plan back to the builder… wait for approval before building."
**Project:** Bea-Bot · branch `module/bea-bot`
**Bot name:** Bea (the Legal Beagle)

Section 0 step 2 (explore the portal) is done; findings are under *What already exists*.
Everything stated in the spec is treated as confirmed by Katy.

---

## What already exists — build on this, don't rebuild it

| The spec asks for | The portal already has |
|---|---|
| A morning scheduled job | `scheduled()` in `_worker.js:375`, three crons live. Add a branch, not a scheduler. |
| Photos in private storage | R2 native binding, used by every client document path. |
| Claude API on the firm's key | `ANTHROPIC_API_KEY` already a secret; six endpoints already call it (`functions/api/help-chat.js` is the shortest example). |
| Monday.com read-only via GraphQL | **Already written** on `origin/module/monday-sync`: `functions/api/_adapters/monday.js` — read-only by design, cursor pagination, pinned API version, columns requested by id. Unmerged. |
| Monday board configured | `wrangler.toml` already sets `MONDAY_BOARD_ID = 2468110147`, `MONDAY_GROUP_ID = new_group` ("Immigration cases"), `MONDAY_API_VERSION = 2024-10`. Nothing reads them yet. |
| Portal page, restricted to Katy | `roles` + `role_module_access`; the Dashboard module (migration 950) is already *"Morning triage view"*. |

**Two overlaps to settle before coding:**

1. **The portal page should extend the existing Dashboard**, not add a second triage screen. Katy's complaint about Monday's AI was clutter; shipping a rival dashboard recreates it.
2. **`priority_items` vs the existing `tasks` table.** `public.tasks` (migration 001) already has `priority`, `status`, `due_date`, `assigned_to`, `matter_id`. The genuinely new fields are `why_katy`, `source_refs` and `last_mentioned_in_brief`. Recommendation: extend `tasks` with those plus a `brief_managed` flag rather than run a parallel task system — otherwise Katy closes something in one place and Bea asks about it the next morning.

---

## Build order

Phase 1 ships in four slices. Each is useful alone and each can be stopped at.

### Slice 0 — Bea logs the group  ← **start here, today**

The only piece that gets permanently worse by waiting: **a Telegram bot cannot read anything sent before it joined.** Every day without her is history that can only ever be recovered from a manual export.

Nothing in this slice calls Claude, touches Monday, or sends anyone a message.

- `functions/api/telegram-webhook.js` — receives `message` and `edited_message`, writes to `tg_messages`, downloads photos via `getFile` (20 MB bot limit) to R2.
- Registered in the `routes` table in `_worker.js`.
- **Must bypass the session-auth pattern** used by the other endpoints — Telegram is the caller, not a logged-in user. Authenticate instead by verifying the `X-Telegram-Bot-Api-Secret-Token` header, and reject anything whose `chat.id` is not the staff group or Katy's private chat.
- Check it against `checkRateLimit` in `_worker.js` — Telegram retries failed deliveries, and a rate-limited webhook silently loses messages.
- Migration `2000_daily_brief_tg_messages.sql`.

**Done when:** every group message, edit, caption and photo lands in `tg_messages`; other chats are ignored; nothing is sent anywhere.

### Slice 1 — the brief, generated but **not sent**

- `functions/api/process-daily-brief.js`, called from the existing `scheduled()` handler (follow `process-doc-reminders.js`, which is called directly with no HTTP wrapper).
- Merge `module/monday-sync` first and reuse its adapter. Add `monday_snapshots` so the job can diff against yesterday instead of restating the whole board.
- Claude call: structured output via `output_config: { format: … }` (**not** the deprecated `output_format`). Do **not** use `tool_choice: {type:"any"|"tool"}` — it returns a 400 on current models; use `auto` with `strict: true`, or structured outputs.
- **Enforce the 5-item cap in code**, after the model returns. The spec asks Claude for "no more than 5"; a prompt is a request, code is a guarantee. This is the single highest-value line in the whole module.
- Write the brief to `brief_log` and **stop**. No DM.
- Prompt and rubric live in an editable file (spec §3, §5) — `functions/api/_prompts/daily-brief.md`, not inline strings.
- Migrations `2001_daily_brief_items.sql`, `2002_daily_brief_log.sql`.

**Done when:** a brief is produced every morning and Katy can read a week of them in the portal before any of them reach her phone. This is the test the spec's §8 asks for, run with zero risk of becoming the Monday agent.

### Slice 2 — sending, and Katy's replies

- Send the brief as a private message. Failure sends a one-line notice — never silent (spec §4.4).
- Reply handling (spec §4.5): parse numbered forms (`"1 done, 2 partial"`) deterministically **first**, hand anything else to Claude, and never apply a change without naming it in the confirmation. A misparse that silently closes an item is the failure that kills trust in the whole thing.
- Ambiguous → ask a short clarifying question, don't guess.

### Slice 3 — the portal page

Extend the Dashboard. Register `daily_brief` in `modules/registry.js` (premium, `group: 'daily'`), add the `role_module_access` rows, restrict to Katy.

UI is bound by the hard rules in `CLAUDE.md`: reuse the `.dk-*` Docket classes in `css/portal.css`, follow `DESIGN-SYSTEM.md`, no parallel aesthetic, no hardcoded colours or fonts, and verify in light **and** dark before commit.

### Note: this is the template, not Katy's portal

Per `CLAUDE.md`, new modules are built in this repo, tested in the sandbox, then deployed to client portals. So the module is firm-agnostic; everything Katy-specific — the two chat IDs, the board id, the send hour — is per-client config in `wrangler.toml` (gitignored), exactly like the Monday and R2 settings already there. Keep Telegram identifiers out of the committed code.

---

## New dependencies

**None.** No new services, no npm packages. Telegram is plain HTTPS; the Claude and Monday calls follow patterns already in the repo. This stays inside the "serverless-first, no n8n, no VPS" rule in `CLAUDE.md`.

New secrets, set via `npx wrangler secret put`:

- `TELEGRAM_BOT_TOKEN`
- `TELEGRAM_WEBHOOK_SECRET`
- `MONDAY_API_TOKEN` (read-only token)

New non-secret vars: `TELEGRAM_STAFF_CHAT_ID`, `TELEGRAM_KATY_CHAT_ID`, `BRIEF_SEND_HOUR_LOCAL`, `BRIEF_TIMEZONE`.

---

## Open questions — and what they actually block

**Nothing here blocks Slice 0.** Bea can be built and installed today.

| Spec §9 | Blocks | Proposed default |
|---|---|---|
| 1. Which board / which columns mean deadline, status, assignee | Slice 1 | Board `2468110147` is already configured and the existing adapter reads `date3`, `status_28`, `status`, `type`, `language`. Needs Katy only to confirm `date3` is the deadline. |
| 2. What time, which timezone | Slice 2 | 9am Central — what the portal's other crons already use, and correct for Querétaro year-round since Mexico dropped DST. |
| 3. Weekends | Slice 2 | No weekend brief; Monday covers 72h, as the spec already describes. |
| 4. Who else sees the list | Slice 3 | Katy only. Adding people later is a row in `role_module_access`. |
| 5. Retention for messages and photos | Nothing | **Unanswered — Katy only.** A records-retention decision, not a technical one. Build it configurable and default to keeping. |
| 6. Other channels later | Nothing | **Unanswered — Katy only.** Changes the data model if yes; costs nothing to ask later. |
| 7. "FYI / delegate" line | Slice 2 | **Unanswered — Katy only.** Recommend leaving it out of v1: it is the most likely place the clutter returns. |

### A cron caveat worth stating

Cron expressions are UTC. A fixed expression cannot be the "configurable timezone" §4.4 asks for — it is right for Querétaro and wrong for US Central half the year. Run the job hourly and gate on the firm's configured local hour instead of encoding the time in the cron.

---

## What Katy has to *do*, not answer

These are steps, not decisions, and Slice 0 cannot finish without them:

1. Create the bot with **@BotFather**, hand the token over to be stored as a secret.
2. **Turn privacy mode off** (`/setprivacy` → Disable), or Bea only receives commands, not messages. If she is added to the group before this change, she must be removed and re-added.
3. Supply the **staff group chat ID** and **Katy's private chat ID**.
4. **Tell the staff the group is now logged** for firm workflow purposes. Katy decides the wording (spec §4.1). This is the one step with no technical substitute.

---

## Verification

- **Slice 0:** send text, a photo with a caption, and an edit to the group; confirm all three land in `tg_messages` with the edit time recorded. Post from an unrelated chat and confirm it is ignored. Run `npm test` — the repo's Vitest suite runs in real workerd and gates deploys.
- **Slice 1:** run the job against a day of real logged messages; check the brief has ≤5 items, each with a reason, a deadline where one exists, and a citation. Read a week of `brief_log` with Katy and tune the rubric file.
- **Slice 2:** reply with a deliberately ambiguous message and confirm it asks rather than guesses.
- Branch per the repo rule: `module/daily-brief`. Never push half-built work to master.
