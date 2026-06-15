-- Migration 501: esign module — seed role_module_access
-- Grants write access to Owner, Attorney, Partner Attorney, Staff Admin.
-- Read access to Paralegal (can view requests, not create them).

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'esign', 'admin' FROM public.roles r WHERE r.name = 'Owner'
ON CONFLICT (role_id, module_key) DO UPDATE SET access_level = 'admin';

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'esign', 'write' FROM public.roles r WHERE r.name IN ('Attorney', 'Partner Attorney', 'Staff Admin')
ON CONFLICT (role_id, module_key) DO UPDATE SET access_level = 'write';

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'esign', 'read' FROM public.roles r WHERE r.name = 'Paralegal'
ON CONFLICT (role_id, module_key) DO UPDATE SET access_level = 'read';
