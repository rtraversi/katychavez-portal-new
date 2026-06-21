-- Migration 1104: iCal feed token per user
-- Each user gets a secret UUID token; the feed URL is /api/calendar/ical-feed?token=<uuid>
-- The token is stable (survives server restarts) and can be regenerated to invalidate old URLs.
-- Apply AFTER migration 1103.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS ical_token UUID DEFAULT gen_random_uuid();

-- Populate existing users who got NULL (shouldn't happen with DEFAULT, but just in case)
UPDATE public.users SET ical_token = gen_random_uuid() WHERE ical_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_ical_token ON public.users (ical_token);
