-- Migration 006: Client portal self-service intake
-- Adds profile_completed_at so staff can see whether a client has filled in
-- their own contact/address details via the "My Profile" tab.
-- Apply AFTER migration 005.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS profile_completed_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.clients.profile_completed_at IS
  'Set by update-client-profile function when client saves their profile via the portal. NULL = not yet submitted.';
