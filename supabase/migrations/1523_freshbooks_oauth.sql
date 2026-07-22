-- Migration 1523: FreshBooks billing integration — OAuth 2.0 token storage
-- Reuses the calendar module's oauth_tokens / oauth_state tables (migrations 1000/1002).
-- FreshBooks connects at the FIRM level (one connection, stored under the connecting
-- Owner/Attorney's user_id) with provider = 'freshbooks'.
--
-- Two additive changes only:
--   1. Allow provider = 'freshbooks' on oauth_tokens (the CHECK constraint from 1002
--      only permits google/outlook).
--   2. Add nullable account_id / business_id columns so the callback can auto-capture
--      the FreshBooks accountId (accounting API) and businessId (time-tracking API)
--      from /auth/api/v1/users/me — no extra env vars needed.
-- Apply AFTER migration 1002.

-- ============================================================================
-- 1. Allow the 'freshbooks' provider
-- ============================================================================

ALTER TABLE public.oauth_tokens
  DROP CONSTRAINT IF EXISTS oauth_tokens_provider_check;

ALTER TABLE public.oauth_tokens
  ADD CONSTRAINT oauth_tokens_provider_check
  CHECK (provider IN ('google', 'outlook', 'freshbooks'));

-- ============================================================================
-- 2. Auto-captured FreshBooks identifiers (null for calendar providers)
-- ============================================================================

ALTER TABLE public.oauth_tokens
  ADD COLUMN IF NOT EXISTS account_id  text,   -- FreshBooks accounting accountId (e.g. "zDmNq")
  ADD COLUMN IF NOT EXISTS business_id text;    -- FreshBooks time-tracking businessId (e.g. "77128")
