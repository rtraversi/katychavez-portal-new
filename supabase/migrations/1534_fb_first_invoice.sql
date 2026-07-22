-- 1534: FreshBooks-first invoice flow — PDF storage support.
--
-- Anita now composes/finalizes invoices directly in FreshBooks (decided
-- 2026-07-16, see FB-FIRST-INVOICE-PLAN.md). The portal mirrors the FB
-- invoice, attaches the Payload pay-link, and stores the FB-generated PDF
-- as a normal matter document so the client can view/download it natively
-- from the portal, not just from FreshBooks.
--
-- documents.source / document_versions.source didn't include 'freshbooks'
-- (1701_storage_sync_schema.sql was written for the pull-sync providers only).
-- invoices.pdf_document_id lets a mirrored invoice point at its stored PDF.

ALTER TABLE public.documents DROP CONSTRAINT IF EXISTS documents_source_check;
ALTER TABLE public.documents ADD CONSTRAINT documents_source_check
  CHECK (source IN ('portal', 'dropbox', 'google_drive', 'onedrive', 'idrive', 'freshbooks'));

ALTER TABLE public.document_versions DROP CONSTRAINT IF EXISTS document_versions_source_check;
ALTER TABLE public.document_versions ADD CONSTRAINT document_versions_source_check
  CHECK (source IN ('portal', 'dropbox', 'google_drive', 'onedrive', 'idrive', 'freshbooks'));

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS pdf_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.invoices.pdf_document_id IS
  'Matter document holding the FreshBooks-generated invoice PDF (FB-first mirror flow). Null if the PDF fetch failed or this invoice was portal-authored.';
