-- Migration 2004: Proof Scan v2 stage runs as queued jobs
--
-- WHY: v2 was built to read a package inside one HTTP request, the way the live
-- checker did before 1302. A full AOS package outlasts that request (the 524
-- that 1302 fixed for the live checker), so a v2 run whose files are staged in
-- R2 is now a row first and work second (functions/api/_proof-scan-v2-job.js).
--
-- The lifecycle columns already exist and are reused as-is: status
-- (queued / processing / error, kept valid for case rows by 1303 / 1304),
-- started_at, completed_at, attempts, error_detail (1302). What a queued run
-- needs on top is what to run: which staged uploads, the individual-review form,
-- and whether to send the stage email. That is `job`. Once the run finishes,
-- `job` keeps only the outcome flags the page shows (follow-up and email
-- results); the upload ids are cleared with the staged files.
--
-- A queued row already carries case_id, stage, scope and rule_set_version, so
-- proof_scans_v2_shape (2001) holds from the moment it is inserted.
--
-- Depends on: 1302 (lifecycle columns), 1303 / 1304, 2001.
-- Idempotent: safe to run twice.

ALTER TABLE public.proof_scans ADD COLUMN IF NOT EXISTS job jsonb;

-- The v2 sweeper's two queries: stuck processing runs and waiting queued runs,
-- both only for case rows. 1302's proof_scans_unfinished_idx covers the status
-- side; this keeps the case_id filter off a full scan as history grows.
CREATE INDEX IF NOT EXISTS proof_scans_v2_unfinished_idx
  ON public.proof_scans (status, created_at)
  WHERE case_id IS NOT NULL AND status IN ('queued', 'processing');
