-- Migration 1003: add client_notified_at to conversations
-- Enables debounced email notifications — cron checks this to avoid re-notifying
-- for messages that were already batched into a prior email.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS client_notified_at TIMESTAMPTZ;
