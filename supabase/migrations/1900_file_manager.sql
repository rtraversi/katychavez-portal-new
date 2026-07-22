-- 1900_file_manager.sql
-- File Manager Phase 1: first-class custom folders per matter.
-- Range 1900-1999 = File Manager.
--
-- Folders were previously only implicit — a folder "existed" iff some document
-- carried its folder_path string, so empty folders were impossible and there
-- was no create/rename/delete. matter_folders makes CUSTOM folders real rows.
-- The fixed folder set (client_uploads, pleadings, agreements, correspondence,
-- financial, attorney_notes, court_orders, trial_docs, admin, other) stays a
-- UI constant and is NOT stored here; documents keep pointing at folders via
-- the documents.folder_path string either way (metadata-only, R2 keys never
-- change on move/rename).

CREATE TABLE IF NOT EXISTS public.matter_folders (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   uuid        NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  path        text        NOT NULL,
  created_by  uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (matter_id, path)
);

CREATE INDEX IF NOT EXISTS idx_matter_folders_matter
  ON public.matter_folders (matter_id);

ALTER TABLE public.matter_folders ENABLE ROW LEVEL SECURITY;

-- Staff with uploads access can list folders directly (Files tab sidebar);
-- create/rename/delete go through the Worker (/api/matter-folders) with the
-- service role because rename cascades folder_path updates across documents.
DROP POLICY IF EXISTS "matter_folders_staff_read" ON public.matter_folders;
CREATE POLICY "matter_folders_staff_read"
  ON public.matter_folders FOR SELECT
  USING (public.can_read('uploads'));

-- Backfill: every non-fixed folder_path already carried by documents becomes a
-- real folder row, so existing synced/imported folders survive as-is.
INSERT INTO public.matter_folders (matter_id, path)
SELECT DISTINCT d.matter_id, d.folder_path
FROM public.documents d
WHERE d.folder_path IS NOT NULL
  AND d.deleted_at IS NULL
  AND d.folder_path NOT IN
    ('all', 'client_uploads', 'pleadings', 'agreements', 'correspondence',
     'financial', 'attorney_notes', 'court_orders', 'trial_docs', 'admin', 'other')
ON CONFLICT (matter_id, path) DO NOTHING;
