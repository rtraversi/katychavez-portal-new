-- Migration 1510: Form Filler module setup
--
-- Reuses the existing `draft_forms` module (key/DB row/RBAC already exist from
-- 002_rbac.sql) for the new USCIS form-filler feature. That module was an unbuilt
-- stub whose name/description collided with the unrelated, already-built
-- `doc_drafting` (.docx templating) module — rename its display copy here.
--
-- Also backfills a real gap: `draft_forms` has no `role_module_access` row for
-- Owner at all today (002_rbac.sql only seeded Attorney='write', Paralegal='read'),
-- and `check_module_access()` does not special-case Owner — without a row, even
-- the firm owner is denied access. 'Partner Attorney' / 'Legal Assistant' are not
-- currently seeded roles (checked: only Owner/Attorney/Paralegal/Staff Admin exist
-- in public.roles), but are included below matching the pattern already used in
-- 1106_doc_drafting.sql so any firm that later adds those custom roles picks up
-- sensible defaults automatically.

UPDATE public.modules
SET name        = 'USCIS Forms',
    description = 'Autofill and generate USCIS immigration form packages (DACA, etc.) from client and matter data.'
WHERE key = 'draft_forms';

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'draft_forms',
  CASE r.name
    WHEN 'Owner'            THEN 'admin'::public.access_level
    WHEN 'Attorney'         THEN 'write'::public.access_level
    WHEN 'Partner Attorney' THEN 'write'::public.access_level
    WHEN 'Paralegal'        THEN 'read'::public.access_level
    WHEN 'Legal Assistant'  THEN 'read'::public.access_level
  END
FROM public.roles r
WHERE r.name IN ('Owner','Attorney','Partner Attorney','Paralegal','Legal Assistant')
ON CONFLICT (role_id, module_key) DO NOTHING;
