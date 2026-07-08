-- Migration 1508: Files folder structure
-- Adds folder_path to documents table for virtual folder organization in the Files tab.
-- Backfills existing documents from doc_type.

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS folder_path TEXT DEFAULT NULL;

-- Backfill from doc_type so old uploads appear in the right folder
UPDATE public.documents SET folder_path = CASE doc_type
  WHEN 'pleading'       THEN 'pleadings'
  WHEN 'agreement'      THEN 'agreements'
  WHEN 'correspondence' THEN 'correspondence'
  WHEN 'financial'      THEN 'financial'
  WHEN 'id'             THEN 'client_uploads'
  WHEN 'court_order'    THEN 'court_orders'
  ELSE 'other'
END
WHERE folder_path IS NULL AND deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_documents_folder_path
  ON public.documents (matter_id, folder_path)
  WHERE deleted_at IS NULL;
