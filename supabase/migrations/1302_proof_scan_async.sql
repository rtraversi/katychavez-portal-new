-- 1302_proof_scan_async.sql — the proof scan becomes a job, not a request.
--
-- A 107-page AOS package cannot finish inside one HTTP request: the edge gives
-- up and returns 524 (PROOF-SCAN-HANDOFF.md §6). So the row is now created
-- BEFORE the work starts and carries the job's state, instead of being written
-- once at the end as a finished report.
--
-- Consequences for the existing shape:
--   • result_html is empty until the scan finishes → it can no longer be NOT NULL
--   • status gains the lifecycle values queued / processing / error alongside
--     the two verdicts, so one column answers both "is it done?" and "what did
--     it find?" — which is what the history list and the poller both read

ALTER TABLE proof_scans ALTER COLUMN result_html DROP NOT NULL;

ALTER TABLE proof_scans DROP CONSTRAINT IF EXISTS proof_scans_status_check;
ALTER TABLE proof_scans ADD CONSTRAINT proof_scans_status_check
  CHECK (status IN ('queued', 'processing', 'pass', 'needs_correction', 'error'));

-- Where the staged package lives in R2 until the job reads it. Null once the
-- scan has consumed it (see functions/api/proof-scan-upload.js).
ALTER TABLE proof_scans ADD COLUMN IF NOT EXISTS upload_id uuid;

-- Why a scan failed, in words, so the UI can say something better than "error".
ALTER TABLE proof_scans ADD COLUMN IF NOT EXISTS error_detail text;

-- Claim bookkeeping. started_at is what the sweeper measures a stuck job
-- against; attempts is what stops a job that fails mid-run from being retried
-- forever by that same sweeper.
ALTER TABLE proof_scans ADD COLUMN IF NOT EXISTS started_at   timestamptz;
ALTER TABLE proof_scans ADD COLUMN IF NOT EXISTS completed_at timestamptz;
ALTER TABLE proof_scans ADD COLUMN IF NOT EXISTS attempts     integer NOT NULL DEFAULT 0;

-- The sweeper's only query: unfinished jobs, oldest first. Partial, because
-- finished scans are the overwhelming majority and never match it.
CREATE INDEX IF NOT EXISTS proof_scans_unfinished_idx
  ON proof_scans (status, created_at)
  WHERE status IN ('queued', 'processing');
