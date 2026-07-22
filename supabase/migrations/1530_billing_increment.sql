-- Migration 1530: billing increment
--
-- Firms bill time in fixed minimum increments (most commonly 6 minutes =
-- 0.1 hr), but time-tracking systems record actual duration to the minute.
-- billing_increment_minutes is the firm-wide increment: every time entry's
-- billable hours are rounded UP to the nearest multiple of this many minutes
-- when pulled for invoicing (FreshBooks pull and portal-native entries alike).
-- The raw tracked duration is preserved and shown in the UI so a human always
-- sees what was rounded — the portal never hides the adjustment.
--
-- 1 (the default) means "bill actual tracked time" — no rounding.

ALTER TABLE public.firm_settings
  ADD COLUMN IF NOT EXISTS billing_increment_minutes integer NOT NULL DEFAULT 1
  CHECK (billing_increment_minutes BETWEEN 1 AND 60);

COMMENT ON COLUMN public.firm_settings.billing_increment_minutes IS
  'Minimum billing increment in minutes; billable time rounds UP to the nearest multiple. 1 = bill actual time (no rounding).';
