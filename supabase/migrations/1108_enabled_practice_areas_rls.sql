-- Migration 1108: Practice area management — RLS + settings module registration

-- ── Owner-write policy for enabled_practice_areas ────────────────────────────
-- Migration 007 only created a SELECT policy; this adds the management policy
-- mirroring the pattern from 1050_enabled_modules.sql

CREATE POLICY "owners can manage enabled_practice_areas"
  ON public.enabled_practice_areas FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.roles r ON u.role_id = r.id
      WHERE u.auth_id = auth.uid() AND r.name = 'Owner'
    )
  );

-- ── Register Practice Areas settings module ───────────────────────────────────

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default)
VALUES (
  'practice_areas_settings',
  'Practice Areas',
  'Enable or disable practice areas for this firm.',
  'briefcase',
  'settings/practice-areas',
  1,
  86,
  true
)
ON CONFLICT (key) DO NOTHING;

-- Owner only — this is a firm configuration page
INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'practice_areas_settings', 'admin'::public.access_level
FROM public.roles r
WHERE r.name = 'Owner'
ON CONFLICT (role_id, module_key) DO NOTHING;
