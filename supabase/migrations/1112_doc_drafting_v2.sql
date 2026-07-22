-- 1107: Document Drafting v2 — WebDAV + versioning + locking
--
-- Upgrades the HTML-based doc_drafting module (1106) to support:
--   - .docx templates stored in R2 (via template_docx_r2_key)
--   - Per-document versioning (every Word save → new version)
--   - Advisory WebDAV lock tracking
--   - draft_document_versions table to preserve every version
--
-- Note: is_final, finalized_at, finalized_by already exist from migration 1106.

-- ── draft_templates: add R2 key for .docx template ───────────────────────────

ALTER TABLE public.draft_templates
  ADD COLUMN IF NOT EXISTS template_docx_r2_key TEXT;

-- ── draft_documents: add versioning + lock columns ───────────────────────────

ALTER TABLE public.draft_documents
  ADD COLUMN IF NOT EXISTS current_version_num  INT         NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS locked_by            UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS locked_at            TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS lock_token           TEXT,
  ADD COLUMN IF NOT EXISTS updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE TRIGGER set_draft_documents_updated_at
  BEFORE UPDATE ON public.draft_documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ── draft_document_versions ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.draft_document_versions (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  UUID        NOT NULL REFERENCES public.draft_documents(id) ON DELETE CASCADE,
  version_num  INT         NOT NULL,
  r2_key       TEXT        NOT NULL,
  size_bytes   INT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by   UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  UNIQUE (document_id, version_num)
);

CREATE INDEX IF NOT EXISTS idx_ddv_document ON public.draft_document_versions (document_id);

ALTER TABLE public.draft_document_versions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ddv_read"  ON public.draft_document_versions
  FOR SELECT USING (can_read('doc_drafting'));
CREATE POLICY "ddv_write" ON public.draft_document_versions
  FOR ALL USING (can_write('doc_drafting'));
