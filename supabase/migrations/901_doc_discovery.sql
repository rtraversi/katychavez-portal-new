-- Migration 901: Document Discovery — offline receipt tracking + reminder infrastructure
-- Extends the documents + matters tables. document_checklists already seeded in 400.
-- Apply AFTER migrations 001–800.

-- ── Add columns to documents ──────────────────────────────────────────────────

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS received_note    TEXT,
  ADD COLUMN IF NOT EXISTS received_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ;

-- ── Add reminder cadence to matters ──────────────────────────────────────────

ALTER TABLE public.matters
  ADD COLUMN IF NOT EXISTS reminder_interval_days INT NOT NULL DEFAULT 7;

-- ── Module registration ───────────────────────────────────────────────────────

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default)
VALUES (
  'doc_templates',
  'Doc Templates',
  'Configure required document checklists per case type.',
  'file-text',
  'settings/doc-templates',
  1,
  85,
  true
)
ON CONFLICT (key) DO NOTHING;

-- Owner + Attorney manage templates; Paralegal/Legal Assistant read-only
INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'doc_templates',
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
