-- Migration 1002: Fix oauth_tokens provider check constraint.
-- The original migration used 'microsoft' but all code uses 'outlook'. Align the constraint.

ALTER TABLE public.oauth_tokens
  DROP CONSTRAINT IF EXISTS oauth_tokens_provider_check;

ALTER TABLE public.oauth_tokens
  ADD CONSTRAINT oauth_tokens_provider_check
  CHECK (provider IN ('google', 'outlook'));
