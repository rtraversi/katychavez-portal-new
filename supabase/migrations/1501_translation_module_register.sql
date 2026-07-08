-- 1501_translation_module_register.sql
-- Register Translation module: modules table, role access, enable for this firm.

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default)
VALUES (
  'translation',
  'Translation',
  'AI-powered Spanish-to-English certified document translation with DOCX & PDF export.',
  'globe',
  'translation',
  1,
  58,
  false
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT id, 'translation', 'write'
FROM public.roles
WHERE name IN ('Owner', 'Attorney', 'Partner Attorney', 'Paralegal', 'Staff Admin')
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Enabled for Katy's firm — no premium gate needed
INSERT INTO public.enabled_modules (module_key)
VALUES ('translation')
ON CONFLICT DO NOTHING;
