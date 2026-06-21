-- 1103_email_log.sql
-- Tracks every outbound email sent via Resend for monitoring purposes.
-- Logged server-side via service key; staff can read via portal monitoring page.

CREATE TABLE IF NOT EXISTS public.email_log (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type       TEXT        NOT NULL,
  to_email   TEXT        NOT NULL,
  subject    TEXT,
  status     TEXT        NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  error      TEXT
);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read email_log" ON public.email_log
  FOR SELECT USING (can_read('core'));
