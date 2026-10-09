// Batch 5 production-boundary and migration readiness checks.
import { describe, it, expect } from 'vitest';
import { PROOF_SCAN_MAX_PDF_BYTES } from '../../functions/api/_schemas.js';
import { MAX_PDF_BYTES } from '../../pages/proof-scan/report-model.js';

const sqlFiles = import.meta.glob('../../supabase/migrations/130{3,4}_*.sql', {
  query: '?raw', import: 'default', eager: true,
});
const sql = (name) => sqlFiles[`../../supabase/migrations/${name}`];
// Max's 1302/1303, renumbered 1303/1304 on the port (1302 is the async scanner).
const migration1302 = sql('1303_proof_scan_structured_results.sql');
const migration1303 = sql('1304_proof_scan_history_metadata.sql');

describe('Proof Scan runtime hardening', () => {
  it('keeps the browser and server at the identical 12 MB limit', () => {
    expect(MAX_PDF_BYTES).toBe(12 * 1024 * 1024);
    expect(PROOF_SCAN_MAX_PDF_BYTES).toBe(MAX_PDF_BYTES);
  });
});

describe('Proof Scan migrations 1302 and 1303', () => {
  it('orders structured storage before history metadata by filename', () => {
    expect('1303_proof_scan_structured_results.sql'
      < '1304_proof_scan_history_metadata.sql').toBe(true);
  });

  it('is additive and contains no data rewrite or destructive table operation', () => {
    const combined = `${migration1302}\n${migration1303}`
      .replace(/--.*$/gm, '');
    expect(combined).not.toMatch(/\b(?:UPDATE|DELETE\s+FROM|TRUNCATE|DROP\s+TABLE)\b/i);
    expect(combined).toMatch(/ALTER TABLE proof_scans ADD COLUMN IF NOT EXISTS result_json/i);
    expect(combined).toMatch(/ALTER TABLE proof_scans ADD COLUMN IF NOT EXISTS attention_count/i);
  });

  it('keeps legacy rows valid and structured rows complete and exclusive', () => {
    expect(migration1302).toMatch(/result_html IS NOT NULL OR result_json IS NOT NULL\s+OR status IN \('queued', 'processing', 'error'\)/);
    expect(migration1303).toMatch(/status IN \('queued', 'processing', 'pass', 'needs_correction', 'error'\)[\s\S]*result_json IS NULL[\s\S]*result_html IS NOT NULL OR status IN \('queued', 'processing', 'error'\)/);
    for (const column of [
      'result_json', 'result_schema_version', 'scan_profile', 'profile_version',
      'report_state', 'attention_count',
    ]) {
      expect(migration1303).toMatch(new RegExp(`${column} IS NOT NULL`));
    }
  });

  it('rejects contradictory attention counts', () => {
    expect(migration1303).toMatch(
      /\(report_state = 'items_need_attention'\) = \(attention_count > 0\)/,
    );
  });

  it('can be rerun without duplicate columns, constraints, or indexes', () => {
    expect(migration1303).toMatch(/ADD COLUMN IF NOT EXISTS attention_count/);
    expect(migration1303).toMatch(/DROP CONSTRAINT IF EXISTS proof_scans_attention_count_state/);
    expect(migration1303).toMatch(/DROP CONSTRAINT IF EXISTS proof_scans_result_shape/);
    expect(migration1303).toMatch(/CREATE INDEX IF NOT EXISTS proof_scans_created_at_idx/);
  });
});
