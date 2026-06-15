-- Migration 1050: IurisIQ tier model
-- Adds modules.tier column (core | premium) and enabled_modules table.
-- Premium modules are off by default; a row in enabled_modules activates them per firm.
-- Applied: dev ☐  prod ☐

-- ──────────────────────────────────────────────────────────────────────────────
-- 1. ADD tier COLUMN TO modules
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.modules
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'core'
  CHECK (tier IN ('core', 'premium'));

-- ──────────────────────────────────────────────────────────────────────────────
-- 2. SET TIER FOR ALL EXISTING MODULES
--    core: core, tasks, uploads, client_portal, doc_templates, dashboard
--    premium: everything else (messaging, esign, conflict_checker, calendar,
--             billing, ai_brain, draft_forms, word_embed)
-- ──────────────────────────────────────────────────────────────────────────────

UPDATE public.modules
SET tier = 'premium'
WHERE key IN (
  'messaging',
  'esign',
  'conflict_checker',
  'calendar',
  'billing',
  'ai_brain',
  'draft_forms',
  'word_embed'
);

-- core/tasks/uploads/client_portal/doc_templates/dashboard keep DEFAULT 'core'

-- ──────────────────────────────────────────────────────────────────────────────
-- 3. CREATE enabled_modules TABLE
--    One row per active premium module for this firm.
--    For multi-tenant future: add firm_id column here before template extraction.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.enabled_modules (
  module_key   text        PRIMARY KEY REFERENCES public.modules(key) ON DELETE CASCADE,
  enabled_at   timestamptz NOT NULL DEFAULT now(),
  enabled_by   uuid        REFERENCES public.users(id) ON DELETE SET NULL
);

-- ──────────────────────────────────────────────────────────────────────────────
-- 4. ROW-LEVEL SECURITY
-- ──────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.enabled_modules ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (menu.js needs this to build the nav)
CREATE POLICY "authenticated can read enabled_modules"
  ON public.enabled_modules FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Only Owners can add / remove enabled modules
CREATE POLICY "owners can manage enabled_modules"
  ON public.enabled_modules FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.roles r ON u.role_id = r.id
      WHERE u.auth_id = auth.uid() AND r.name = 'Owner'
    )
  );

-- ──────────────────────────────────────────────────────────────────────────────
-- 5. SEED — enable built premium modules for this deployment
--    Edit this list to match what the client has purchased.
--    comingSoon modules (billing, ai_brain, draft_forms, word_embed) excluded until built.
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO public.enabled_modules (module_key) VALUES
  ('messaging'),
  ('esign'),
  ('conflict_checker'),
  ('calendar')
ON CONFLICT (module_key) DO NOTHING;
