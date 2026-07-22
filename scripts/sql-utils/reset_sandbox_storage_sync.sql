-- reset_sandbox_storage_sync.sql
-- ONE-TIME sandbox reconciliation for the dropbox_sync → storage_sync rename.
-- Safe to run ONLY on the sandbox, where the Dropbox sync data is disposable
-- e2e test data. Never run against a live client — no client was ever on the
-- old dropbox_* schema, so they start clean on the neutral 1700/1701.
--
-- Order of operations:
--   1. Run THIS script on the sandbox (drops the old dropbox_* sync tables,
--      widens the provenance CHECK constraints, removes the old module rows).
--   2. Apply the rewritten migrations 1700_storage_sync_module.sql and
--      1701_storage_sync_schema.sql (they recreate everything, neutral).
--   3. Re-run the e2e sync test pass.

BEGIN;

-- ── 1. Drop the old provider-specific sync tables ────────────────────────────
-- (document_versions is kept — it also holds portal-upload version history.)
DROP TABLE IF EXISTS public.dropbox_unmatched_files CASCADE;
DROP TABLE IF EXISTS public.dropbox_sync_ledger     CASCADE;
DROP TABLE IF EXISTS public.dropbox_sync_state       CASCADE;
DROP TABLE IF EXISTS public.dropbox_folder_aliases   CASCADE;

-- ── 2. Widen the provenance CHECK constraints to the provider set ────────────
-- The old 1701 constrained source to ('portal','dropbox'); the neutral 1701
-- uses ADD COLUMN IF NOT EXISTS, which no-ops on the already-present columns,
-- so we widen the live constraints here instead.
ALTER TABLE public.documents         DROP CONSTRAINT IF EXISTS documents_source_check;
ALTER TABLE public.documents         ADD  CONSTRAINT documents_source_check
  CHECK (source IN ('portal', 'dropbox', 'google_drive', 'onedrive', 'idrive'));

ALTER TABLE public.document_versions DROP CONSTRAINT IF EXISTS document_versions_source_check;
ALTER TABLE public.document_versions ADD  CONSTRAINT document_versions_source_check
  CHECK (source IN ('portal', 'dropbox', 'google_drive', 'onedrive', 'idrive'));

-- ── 3. Remove the old module registration rows ───────────────────────────────
DELETE FROM public.enabled_modules    WHERE module_key = 'dropbox_sync';
DELETE FROM public.role_module_access WHERE module_key = 'dropbox_sync';
DELETE FROM public.modules            WHERE key        = 'dropbox_sync';

-- ── 4. OPTIONAL: purge previously-pulled test documents for a clean backfill ──
-- With the ledger wiped, a fresh backfill re-imports every Dropbox file as new,
-- leaving the old test pulls as orphan duplicates. Uncomment to delete them
-- (destructive — sandbox test data only; the R2 objects are left untouched and
-- can be cleaned separately).
--   DELETE FROM public.document_versions
--     WHERE source <> 'portal';
--   DELETE FROM public.documents
--     WHERE source <> 'portal';

COMMIT;
