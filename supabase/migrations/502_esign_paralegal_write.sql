-- Migration 502: upgrade Paralegal esign access from read → write
-- Texas law allows all firm staff (including paralegals) to send e-sign requests.
-- Counter-signing remains attorney-only (enforced in sign-document.js, not here).

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'esign', 'write' FROM public.roles r WHERE r.name = 'Paralegal'
ON CONFLICT (role_id, module_key) DO UPDATE SET access_level = 'write';
