-- Migration 700: Attorney color coding
-- Adds a hex color to staff user records for visual identification in the portal.
-- Displayed as a colored dot next to attorney names in the client list.
-- Apply in any order after migration 002.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS color text DEFAULT NULL;

COMMENT ON COLUMN public.users.color IS
  'Hex color string (e.g. #3B82F6) for visual identification in client list. Owner/admin sets in Settings > Users.';
