-- Migration 1303: history metadata for structured Proof Scan rows
--
-- Batch 4 of the Proof Scan production integration. Purely additive; nothing here
-- rewrites, relabels or deletes a legacy row.
--
-- The history list must show the deterministic report language — "N items need
-- attention", "Review incomplete", "No issues found" — for ten rows at once. The
-- language is derived from `report_state` plus the attention count, and the count
-- lives inside `result_json`, which is ~21 KB per row. Reading ten of those to
-- print ten short phrases is the wrong trade, so the count is denormalised here.
--
-- It is metadata for the LIST only. Opening a scan still re-validates the full
-- `result_json`, recomputes the state from the stored items, and refuses to render
-- anything inconsistent — this column is never the authority for a rendered report.

ALTER TABLE proof_scans ADD COLUMN IF NOT EXISTS attention_count integer;

-- A structured row must carry a count that agrees with its state. Legacy rows
-- (result_json IS NULL) keep attention_count NULL and are unaffected.
--
-- Deliberately asymmetric: items_need_attention REQUIRES a positive count, so a
-- structured row can never present as clean because its count went missing.
ALTER TABLE proof_scans DROP CONSTRAINT IF EXISTS proof_scans_attention_count_state;
ALTER TABLE proof_scans ADD CONSTRAINT proof_scans_attention_count_state
  CHECK (result_json IS NULL
         OR (attention_count IS NOT NULL
             AND attention_count >= 0
             AND (report_state = 'items_need_attention') = (attention_count > 0)));

-- Keep the legacy and structured representations mutually exclusive and make
-- every structured metadata column mandatory as one unit. Existing legacy rows
-- satisfy the second branch unchanged; no row is rewritten.
ALTER TABLE proof_scans DROP CONSTRAINT IF EXISTS proof_scans_result_shape;
ALTER TABLE proof_scans ADD CONSTRAINT proof_scans_result_shape
  CHECK ((status = 'structured'
          AND result_json IS NOT NULL
          AND result_html IS NULL
          AND result_schema_version IS NOT NULL
          AND scan_profile IS NOT NULL
          AND profile_version IS NOT NULL
          AND report_state IS NOT NULL
          AND attention_count IS NOT NULL)
         OR
         (status IN ('pass', 'needs_correction')
          AND result_json IS NULL
          AND result_html IS NOT NULL
          AND result_schema_version IS NULL
          AND scan_profile IS NULL
          AND profile_version IS NULL
          AND report_state IS NULL
          AND attention_count IS NULL));

-- The history list is "the last 10, newest first" for every caller.
CREATE INDEX IF NOT EXISTS proof_scans_created_at_idx
  ON proof_scans (created_at DESC);
