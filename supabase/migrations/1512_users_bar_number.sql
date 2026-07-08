-- Migration 1512: users.bar_number
--
-- Real pre-existing gap: functions/api/drafting-generate.js already selects
-- `bar_number` from public.users (and uses it as {{attorney_bar_number}}), but
-- the column was never actually migrated. Needed now for G-28 attorney autofill;
-- also fixes the existing doc_drafting module's silent undefined today.

ALTER TABLE public.users ADD COLUMN IF NOT EXISTS bar_number text;
