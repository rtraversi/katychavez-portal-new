-- 1702_storage_sync_client_import.sql
-- On-demand per-client Dropbox/Drive backfill: staff-triggered, staff-confirmed
-- import of ONE client's existing storage folder — as opposed to the
-- all-or-nothing STORAGE_SYNC_BACKFILL flood or the incremental 5-min cron.
--
-- Flow: staff opens a client, clicks "Import from Storage"; the route matches
-- the client to a top-level provider folder (alias table, else fuzzy "Last,
-- First"), staff confirms the folder AND picks the target matter, then the
-- files are pulled through the exact same importEntry() pipeline the cron
-- uses (AV scan, staff-only until published, ledger dedup). Large folders are
-- processed in batches across repeated calls — this table is the resumable
-- work queue for that, mirroring storage_sync_state.pending.

CREATE TABLE IF NOT EXISTS public.storage_sync_client_import_jobs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id      uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  matter_id      uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  provider       text NOT NULL
                 CHECK (provider IN ('dropbox', 'google_drive', 'onedrive', 'idrive')),
  folder_name    text NOT NULL,   -- display name of the matched top-level folder
  folder_lower   text NOT NULL,   -- lowercased — written to storage_sync_aliases on start
  status         text NOT NULL DEFAULT 'running'
                 CHECK (status IN ('running', 'completed', 'failed')),
  -- Files listed from the provider but not yet imported (batched the same way
  -- the cron's storage_sync_state.pending is — Worker CPU/subrequest limits).
  pending        jsonb NOT NULL DEFAULT '[]'::jsonb,
  imported_count int NOT NULL DEFAULT 0,
  skipped_count  int NOT NULL DEFAULT 0,
  error_count    int NOT NULL DEFAULT 0,
  last_error     text,
  created_by     uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_storage_import_jobs_client
  ON public.storage_sync_client_import_jobs (client_id, created_at DESC);

ALTER TABLE public.storage_sync_client_import_jobs ENABLE ROW LEVEL SECURITY;

-- Staff with storage_sync access can read job progress directly (poll from the
-- client card); all writes go through the Worker with the service role.
DROP POLICY IF EXISTS "storage_import_jobs_staff_read" ON public.storage_sync_client_import_jobs;
CREATE POLICY "storage_import_jobs_staff_read"
  ON public.storage_sync_client_import_jobs FOR SELECT
  USING (public.can_read('storage_sync'));
