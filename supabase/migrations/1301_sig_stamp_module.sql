-- Migration 1301: Register Signature Stamp as a module
-- sig_stamp has no DB schema (uses attorney_settings table from core);
-- this migration just registers it in modules + role_module_access.

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default)
VALUES (
  'sig_stamp',
  'Signature Stamp',
  'Apply attorney signature stamp to documents within the portal.',
  'pen-tool',
  'sig-stamp',
  1,
  82,
  false
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT id, 'sig_stamp', 'write'
FROM public.roles
WHERE name IN ('Owner', 'Attorney', 'Partner Attorney')
ON CONFLICT (role_id, module_key) DO NOTHING;

INSERT INTO public.enabled_modules (module_key)
VALUES ('sig_stamp')
ON CONFLICT DO NOTHING;
