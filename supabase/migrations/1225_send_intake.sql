-- Migration 1225: Send Intake — pre-portal public intake webform
-- Lets staff email a client a tokenized, expiring intake link (/intake?token=)
-- so the client can complete intake WITHOUT a portal account. The public form
-- writes into the SAME structured intake tables (opposing_parties, children,
-- financial_info, and the matters marriage fields) and then sets the existing
-- intake_submitted_at lock (migration 1222).
--
-- The public endpoints are authorized SOLELY by intake_token — the same trust
-- model as the unauthenticated iCal feed token (users.ical_token). No new RLS /
-- access surface for authenticated users; writes go through the admin client in
-- functions/api/intake-public-*.js.

ALTER TABLE public.matters
  ADD COLUMN IF NOT EXISTS intake_token       uuid        DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS intake_sent_at     timestamptz DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS intake_expires_at  timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.matters.intake_token IS
  'Opaque capability token authorizing the public pre-portal intake webform (/intake?token=). NULL = no outstanding link. Rotated on every resend (old link dies). Cleared once intake_submitted_at is set.';
COMMENT ON COLUMN public.matters.intake_sent_at IS
  'When staff last sent the public intake link. Drives the "Intake sent…" status on the client card.';
COMMENT ON COLUMN public.matters.intake_expires_at IS
  'Hard expiry for intake_token (14 days from send). The public endpoints reject the token past this instant.';

-- Fast lookup by token for the unauthenticated public endpoints.
CREATE INDEX IF NOT EXISTS matters_intake_token_idx
  ON public.matters (intake_token) WHERE intake_token IS NOT NULL;
