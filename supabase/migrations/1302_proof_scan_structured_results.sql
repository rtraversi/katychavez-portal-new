-- Migration 1302: additive structured Proof Scan results
--
-- Batch 2 of the Proof Scan production integration. Purely additive: every legacy
-- row keeps its `result_html` verbatim and nothing here rewrites or deletes one.
--
-- `result_html` was NOT NULL, which would have forced structured rows to invent
-- fake HTML. It is now nullable, and a table-level check keeps every row carrying
-- at least one result representation — legacy HTML or structured JSON.
--
-- The legacy `status` column stays for compatibility with the not-yet-ported
-- history list (Batch 4 replaces that rendering). Structured rows write the
-- neutral sentinel 'structured' and NEVER 'pass': the application contract reads
-- `report_state`, and the old history renderer treats any non-'pass' value as its
-- conservative label, so a structured row can never surface as a PASS verdict.
-- `report_state` itself has no PASS member and is null only on legacy rows.

ALTER TABLE proof_scans ALTER COLUMN result_html DROP NOT NULL;

ALTER TABLE proof_scans ADD COLUMN IF NOT EXISTS result_json            jsonb;
ALTER TABLE proof_scans ADD COLUMN IF NOT EXISTS result_schema_version  integer;
ALTER TABLE proof_scans ADD COLUMN IF NOT EXISTS scan_profile           text;
ALTER TABLE proof_scans ADD COLUMN IF NOT EXISTS profile_version        integer;
ALTER TABLE proof_scans ADD COLUMN IF NOT EXISTS report_state           text;
ALTER TABLE proof_scans ADD COLUMN IF NOT EXISTS model                  text;
ALTER TABLE proof_scans ADD COLUMN IF NOT EXISTS model_stop_reason      text;
ALTER TABLE proof_scans ADD COLUMN IF NOT EXISTS input_tokens           integer;
ALTER TABLE proof_scans ADD COLUMN IF NOT EXISTS output_tokens          integer;

-- Widen the legacy status check for the neutral structured sentinel. Existing
-- 'pass' / 'needs_correction' rows keep their value.
ALTER TABLE proof_scans DROP CONSTRAINT IF EXISTS proof_scans_status_check;
ALTER TABLE proof_scans ADD CONSTRAINT proof_scans_status_check
  CHECK (status IN ('pass', 'needs_correction', 'structured'));

-- Derived report state. 'scan_could_not_be_completed' is deliberately absent: a
-- scan that fails validation is never stored at all.
ALTER TABLE proof_scans DROP CONSTRAINT IF EXISTS proof_scans_report_state_check;
ALTER TABLE proof_scans ADD CONSTRAINT proof_scans_report_state_check
  CHECK (report_state IS NULL
         OR report_state IN ('items_need_attention', 'review_incomplete', 'no_issues_found'));

-- A structured row must carry its profile identity and schema version alongside
-- the JSON, so a stored result can always be replayed against the right profile.
ALTER TABLE proof_scans DROP CONSTRAINT IF EXISTS proof_scans_structured_complete;
ALTER TABLE proof_scans ADD CONSTRAINT proof_scans_structured_complete
  CHECK (result_json IS NULL
         OR (scan_profile IS NOT NULL
             AND profile_version IS NOT NULL
             AND result_schema_version IS NOT NULL
             AND report_state IS NOT NULL));

-- Every row keeps a readable result: legacy HTML or structured JSON.
ALTER TABLE proof_scans DROP CONSTRAINT IF EXISTS proof_scans_result_present;
ALTER TABLE proof_scans ADD CONSTRAINT proof_scans_result_present
  CHECK (result_html IS NOT NULL OR result_json IS NOT NULL);

CREATE INDEX IF NOT EXISTS proof_scans_scan_profile_idx
  ON proof_scans (scan_profile, created_at DESC);
