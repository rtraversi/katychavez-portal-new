-- Migration 1000: Calendar module — Google (and future Microsoft) OAuth integration
-- Stores per-user OAuth tokens and short-lived CSRF state for the OAuth redirect flow.
-- Apply AFTER migrations 001–003.

-- ============================================================================
-- 1. OAUTH TOKEN STORAGE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.oauth_tokens (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider      text         NOT NULL CHECK (provider IN ('google', 'microsoft')),
  access_token  text,
  refresh_token text         NOT NULL,
  token_expiry  timestamptz,
  account_email text,
  created_at    timestamptz  DEFAULT now(),
  updated_at    timestamptz  DEFAULT now(),
  UNIQUE(user_id, provider)
);

CREATE INDEX idx_oauth_tokens_user ON public.oauth_tokens (user_id);

ALTER TABLE public.oauth_tokens ENABLE ROW LEVEL SECURITY;
-- Service key only — no client-facing RLS needed

-- ============================================================================
-- 2. OAUTH STATE (CSRF protection for redirect flow)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.oauth_state (
  state      text         PRIMARY KEY,
  user_id    uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider   text         NOT NULL DEFAULT 'google',
  expires_at timestamptz  NOT NULL DEFAULT (now() + interval '10 minutes')
);

ALTER TABLE public.oauth_state ENABLE ROW LEVEL SECURITY;
-- Service key only

-- ============================================================================
-- 3. MODULE REGISTRATION
-- ============================================================================

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default)
VALUES (
  'calendar',
  'Calendar',
  'Google Calendar integration — view and create events from the portal.',
  'calendar',
  'calendar',
  1,
  45,
  false
)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 4. ROLE ACCESS — all staff (not Client); premium module, disabled by default
-- ============================================================================

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT id, 'calendar', 'write'
FROM public.roles
WHERE name != 'Client'
ON CONFLICT (role_id, module_key) DO NOTHING;
