-- Activate the USCIS Forms (draft_forms) premium module for this firm.
-- Run once after migrations 1510-1514 are applied.
INSERT INTO public.enabled_modules (module_key) VALUES ('draft_forms')
ON CONFLICT (module_key) DO NOTHING;
