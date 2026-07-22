-- 1701_storage_sync_schema.sql
-- Provider-agnostic schema for the Storage Sync pull direction (storage → portal).
-- One engine, many providers: every row is tagged with `provider` ('dropbox',
-- 'google_drive', 'onedrive', 'idrive'). Provider-neutral column naming:
--   • remote_id   — the provider's stable per-file key: the path_lower for
--                   Dropbox, the file-id for Google Drive/OneDrive.
--   • remote_path — human-readable display path (for the review UI).
--   • remote_rev  — the provider's revision token (Dropbox rev, Drive
--                   headRevisionId, …). The (path/id, rev) pair is the loop guard.
--
-- Tables:
--   • document_versions — general documents get version history (only
--     draft_documents had it); documents.r2_key keeps pointing at the latest
--     version for backward compatibility.
--   • documents.client_visible — pulled files are staff-only until a staff
--     member explicitly publishes them (decision 2026-07-03, reaffirmed
--     2026-07-04: NEVER client-facing on arrival).
--   • documents.source — provenance ('portal' | a provider key).
--   • storage_sync_state — per-provider cursor + work queue for the 5-min cron.
--   • storage_sync_ledger — every synced (provider, remote_id, remote_rev);
--     read by the pull loop check so the mirror's own writes don't echo back.
--   • storage_sync_unmatched — staff review queue for files that can't auto-attach.
--   • storage_sync_aliases — folder → client/matter mappings for folders that
--     can't name-match (e.g. PF matters named by family name).

-- ── Document versioning ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.document_versions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id  uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  version_no   int  NOT NULL,
  r2_key       text NOT NULL,
  file_size    bigint,
  content_hash text,
  source       text NOT NULL DEFAULT 'portal'
               CHECK (source IN ('portal', 'dropbox', 'google_drive', 'onedrive', 'idrive')),
  created_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (document_id, version_no)
);

CREATE INDEX IF NOT EXISTS idx_document_versions_doc
  ON public.document_versions (document_id, version_no DESC);

-- ── Staff-only visibility gate + provenance on documents ────────────────────

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT true;

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'portal'
  CHECK (source IN ('portal', 'dropbox', 'google_drive', 'onedrive', 'idrive'));

-- Clients only see documents explicitly marked visible. Default true keeps
-- every existing document (and normal portal uploads) behaving as before;
-- the pull pipeline inserts with client_visible = false.
DROP POLICY IF EXISTS "docs_select_client" ON public.documents;
CREATE POLICY "docs_select_client"
  ON public.documents FOR SELECT
  USING (
    deleted_at IS NULL
    AND client_visible
    AND matter_id IN (
      SELECT id FROM public.matters
      WHERE client_id = public.my_client_id() AND NOT is_dv_confidential
    )
  );

-- ── Pull-sync state (one row per provider) ───────────────────────────────────

CREATE TABLE IF NOT EXISTS public.storage_sync_state (
  provider     text PRIMARY KEY
               CHECK (provider IN ('dropbox', 'google_drive', 'onedrive', 'idrive')),
  cursor       text,
  -- Entries listed from the provider but not yet processed (the cron imports
  -- in small batches to stay inside Worker CPU limits; leftovers wait here).
  pending      jsonb NOT NULL DEFAULT '[]'::jsonb,
  last_run_at  timestamptz,
  last_error   text,
  files_pulled int NOT NULL DEFAULT 0,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ── Sync ledger (both directions write; pull reads for the loop check) ───────

CREATE TABLE IF NOT EXISTS public.storage_sync_ledger (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     text NOT NULL
               CHECK (provider IN ('dropbox', 'google_drive', 'onedrive', 'idrive')),
  remote_id    text NOT NULL,   -- path_lower (Dropbox) | file-id (Drive/OneDrive)
  remote_path  text,            -- display path, best-effort
  remote_rev   text NOT NULL,
  content_hash text,
  r2_key       text,
  document_id  uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  direction    text NOT NULL CHECK (direction IN ('push', 'pull')),
  synced_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, remote_id, remote_rev)
);

CREATE INDEX IF NOT EXISTS idx_storage_ledger_hash
  ON public.storage_sync_ledger (provider, content_hash);
CREATE INDEX IF NOT EXISTS idx_storage_ledger_remote
  ON public.storage_sync_ledger (provider, remote_id);

-- ── Unmatched review queue ───────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.storage_sync_unmatched (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider     text NOT NULL
               CHECK (provider IN ('dropbox', 'google_drive', 'onedrive', 'idrive')),
  remote_id    text NOT NULL,
  remote_path  text NOT NULL,
  file_name    text NOT NULL,
  file_size    bigint,
  remote_rev   text,
  content_hash text,
  reason       text NOT NULL CHECK (reason IN
                 ('no_client_match', 'multiple_matters', 'no_active_matter',
                  'conflicted_copy', 'over_size', 'infected', 'error')),
  detail       text,
  status       text NOT NULL DEFAULT 'pending'
               CHECK (status IN ('pending', 'resolved', 'ignored')),
  resolved_document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  resolved_by  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  resolved_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, remote_id, remote_rev)
);

CREATE INDEX IF NOT EXISTS idx_storage_unmatched_pending
  ON public.storage_sync_unmatched (status) WHERE status = 'pending';

-- ── Folder aliases (folder → client/matter, for non-name-matching folders) ──

CREATE TABLE IF NOT EXISTS public.storage_sync_aliases (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider          text NOT NULL
                    CHECK (provider IN ('dropbox', 'google_drive', 'onedrive', 'idrive')),
  folder_path_lower text NOT NULL,
  client_id         uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  matter_id         uuid REFERENCES public.matters(id) ON DELETE CASCADE,
  created_by        uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, folder_path_lower)
);

-- ── RLS: worker-only tables (service role bypasses; no client policies) ─────

ALTER TABLE public.document_versions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_sync_state     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_sync_ledger    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_sync_unmatched ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.storage_sync_aliases   ENABLE ROW LEVEL SECURITY;

-- Staff with uploads access can read version history directly (Files tab);
-- writes go through the Worker with the service role.
-- (DROP-then-CREATE keeps this migration re-runnable — document_versions can
-- survive a sandbox reset with its policy already in place.)
DROP POLICY IF EXISTS "document_versions_staff_read" ON public.document_versions;
CREATE POLICY "document_versions_staff_read"
  ON public.document_versions FOR SELECT
  USING (public.can_read('uploads'));

-- Staff with storage_sync access can read queue/state directly (nav badge,
-- module page); all writes go through the Worker with the service role.
DROP POLICY IF EXISTS "storage_unmatched_staff_read" ON public.storage_sync_unmatched;
CREATE POLICY "storage_unmatched_staff_read"
  ON public.storage_sync_unmatched FOR SELECT
  USING (public.can_read('storage_sync'));

DROP POLICY IF EXISTS "storage_sync_state_staff_read" ON public.storage_sync_state;
CREATE POLICY "storage_sync_state_staff_read"
  ON public.storage_sync_state FOR SELECT
  USING (public.can_read('storage_sync'));
