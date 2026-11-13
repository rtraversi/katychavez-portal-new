-- Migration 2000: Bea-Bot — Telegram staff-group message log
--
-- Slice 0 of BEA-BOT-PLAN.md. Bea sits in the staff group and records what is
-- said there; nothing in this slice reads the table back, calls Claude, or
-- sends anyone a message.
--
-- Why this is first: a Telegram bot cannot read anything sent before it joined
-- the group. Every day the log does not exist is history that only a manual
-- export can recover.
--
-- Apply AFTER migrations 001–1903.

CREATE TABLE IF NOT EXISTS public.tg_messages (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Telegram's own identity for the message. Unique together, and the conflict
  -- target the webhook upserts on: Telegram retries any delivery it does not
  -- get a 2xx for, so the same update can legitimately arrive more than once.
  chat_id     bigint      NOT NULL,
  message_id  bigint      NOT NULL,

  sender_name text,                 -- display name as Telegram gave it
  sender_id   text,                 -- Telegram user id, as text (they are large)

  sent_at     timestamptz NOT NULL, -- original send time, unchanged by an edit
  edited_at   timestamptz,          -- set only when the message was edited

  text        text,                 -- message text, or a media caption

  reply_to_message_id bigint,       -- threads a staff question to Katy's answer

  -- Telegram's own thread grouping. Present on messages that belong to a reply
  -- thread, and on every message in a forum-style group with topics enabled.
  -- Phase 2 has to reconstruct conversations out of this log, so the grouping
  -- Telegram already computed is worth keeping rather than re-deriving.
  message_thread_id   bigint,

  -- R2 object keys for photos and image/PDF documents on this message. The
  -- files live in R2, never in the DB — house rule in CLAUDE.md.
  media_paths text[]      NOT NULL DEFAULT '{}',

  -- The untouched update, for Phase 2. Reconstructing a conversation months
  -- from now is much easier with the original than with our reading of it.
  raw         jsonb,

  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT tg_messages_chat_message_key UNIQUE (chat_id, message_id)
);

-- The daily job reads "everything since yesterday", so time is the hot path.
CREATE INDEX IF NOT EXISTS idx_tg_messages_sent_at   ON public.tg_messages (sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_tg_messages_chat_sent ON public.tg_messages (chat_id, sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_tg_messages_reply_to  ON public.tg_messages (reply_to_message_id)
  WHERE reply_to_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tg_messages_thread    ON public.tg_messages (message_thread_id)
  WHERE message_thread_id IS NOT NULL;

-- RLS on, and deliberately NO policy yet.
--
-- This table holds the firm's staff chat verbatim, which means client names,
-- A-numbers and case facts. Until there is a screen that needs to read it,
-- nothing should be able to: the Worker uses the service role, which bypasses
-- RLS, and every other caller gets nothing. Slice 3 adds a read policy gated on
-- public.can_read('daily_brief') when the module and its role grants exist.
ALTER TABLE public.tg_messages ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.tg_messages IS
  'Bea-Bot: verbatim log of the staff Telegram group. Contains client data. '
  'Service-role access only until Slice 3 adds a read policy.';
