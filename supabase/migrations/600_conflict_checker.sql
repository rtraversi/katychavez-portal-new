-- Migration 600: Conflict checker module
-- Adds conflict_checks audit table and registers the module for staff access.
-- "Conflict check" = checking whether the firm has prior/current relationships
--  with a prospective new client or their opposing party (conflict of interest).
-- Apply AFTER migrations 001–003.

-- ============================================================================
-- 1. AUDIT TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.conflict_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at   timestamptz NOT NULL DEFAULT now(),
  checked_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,

  -- Names searched
  prospective_client_name  text NOT NULL,
  opposing_party_name      text,
  additional_names         text[],

  -- Snapshot of search results (for audit trail)
  matches_found            jsonb NOT NULL DEFAULT '[]',

  -- Staff decision
  outcome   text CHECK (outcome IN ('clear', 'conflict', 'review_needed')),
  notes     text,

  -- Optional link once client is accepted
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL
);

CREATE INDEX idx_conflict_checks_by   ON public.conflict_checks (checked_by);
CREATE INDEX idx_conflict_checks_at   ON public.conflict_checks (checked_at DESC);
CREATE INDEX idx_conflict_checks_name ON public.conflict_checks
  USING gin (to_tsvector('simple', prospective_client_name));

ALTER TABLE public.conflict_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conflict_checks_select" ON public.conflict_checks
  FOR SELECT USING (public.can_read('core'));

CREATE POLICY "conflict_checks_write" ON public.conflict_checks
  FOR ALL USING (public.can_write('core'));

-- ============================================================================
-- 2. MODULE REGISTRATION
-- ============================================================================

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default)
VALUES (
  'conflict_checker',
  'Conflict Check',
  'Search for conflicts of interest before accepting a new client.',
  'shield',
  'conflict-checker',
  1,
  25,
  true
)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 3. ROLE ACCESS — all staff roles except Client
-- ============================================================================

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT id, 'conflict_checker', 'write'
FROM public.roles
WHERE name != 'Client'
ON CONFLICT (role_id, module_key) DO NOTHING;
