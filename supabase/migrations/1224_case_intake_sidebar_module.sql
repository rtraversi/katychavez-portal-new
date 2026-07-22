-- Migration 1224: Case Intake sidebar entry
-- Breaks "Case Intake" out of the My Matter tab bar into its own top-level
-- sidebar item for clients, since it was easy to miss as one of four equal
-- tabs. Reuses the client-portal page bundle (see js/menu.js route alias) —
-- this is a UI routing/visibility change only, not a new data surface; the
-- underlying tables/RLS from migrations 1100/1222/1223 are unchanged.

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default)
VALUES ('case_intake', 'Case Intake',
        'Client-facing intake form — opposing party, marriage, children, and financial details.',
        'check-square', 'case-intake', 0, 6, true)
ON CONFLICT (key) DO NOTHING;

DO $$
DECLARE
  r_client uuid;
BEGIN
  SELECT id INTO r_client FROM public.roles WHERE name = 'Client';

  INSERT INTO public.role_module_access (role_id, module_key, access_level)
  VALUES (r_client, 'case_intake', 'write')
  ON CONFLICT (role_id, module_key) DO NOTHING;
END $$;
