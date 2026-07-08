-- Migration 1516: key_dates.time_value
--
-- Ported from wilsonlakesavage's 1203_key_dates_time.sql — schema only.
-- That migration also updated a specific seeded form template (form_number
-- '3.4') to use a {{hearing_time}} placeholder; that form is WLS-specific
-- content (TX Family Law Practice Manual), not template material, so it's
-- intentionally not carried over here.
--
-- Adds an optional time_value column to key_dates so hearings/depositions/
-- mediations can store a time alongside the date.

ALTER TABLE public.key_dates ADD COLUMN IF NOT EXISTS time_value TEXT;
