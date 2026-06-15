-- Migration 1001: Link key_dates to Google Calendar events
-- Adds google_event_id so staff can track which key dates have been pushed to Google Calendar.

ALTER TABLE public.key_dates
  ADD COLUMN IF NOT EXISTS google_event_id TEXT;
