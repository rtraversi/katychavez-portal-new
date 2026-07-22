-- 1800_office_edit_module.sql
-- Register Office Edit ("Edit in Word") as a premium module.
-- Staff click "Edit in Word" on a .docx in the matter Files tab → desktop Word
-- launches via the ms-word: protocol against the portal's WebDAV endpoint
-- (functions/api/webdav.js, kind='doc') and saves land straight back in R2.
-- Range 1800-1899 = Office Edit.

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default, tier)
VALUES (
  'office_edit',
  'Edit in Word',
  'Open matter documents in desktop Microsoft Word straight from the portal — saves go back to the matter file automatically.',
  'edit-3',
  'office-edit',
  1,
  63,
  false,
  'premium'
)
ON CONFLICT (key) DO NOTHING;

-- Staff who work documents can edit; Owner/Staff Admin administer.
INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT id, 'office_edit',
       CASE WHEN name IN ('Owner', 'Staff Admin') THEN 'admin' ELSE 'write' END::public.access_level
FROM public.roles
WHERE name IN ('Owner', 'Attorney', 'Partner Attorney', 'Paralegal', 'Staff Admin')
ON CONFLICT (role_id, module_key) DO NOTHING;

-- Advisory checkout lock while a document is open in Word
-- (mirrors draft_documents.locked_by/locked_at/lock_token from 1112).
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS edit_locked_by   UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS edit_locked_at   TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS edit_lock_token  TEXT;

-- Enable for this firm (sandbox). Client deploys opt in per-firm.
INSERT INTO public.enabled_modules (module_key)
VALUES ('office_edit')
ON CONFLICT DO NOTHING;
