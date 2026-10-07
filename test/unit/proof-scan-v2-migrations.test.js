import { describe, expect, it } from 'vitest';

// Static guard for the Proof Scan v2 migrations (2000 and up). Migration 1300
// shipped `USING (true)` policies with no role named, which exposed scan reports
// to the public key and to client logins (PROOF-SCAN-V2-SPECS.md section B).
// These tests fail if a v2 migration ever repeats that, or adds a table without
// row level security.
const files = import.meta.glob('../../supabase/migrations/2[0-9][0-9][0-9]_*.sql', {
  query: '?raw', import: 'default', eager: true,
});
const migrations = Object.entries(files)
  .map(([path, sql]) => ({ name: path.split('/').pop(), sql }))
  .filter(({ name }) => /^20\d\d_proof_scan/.test(name));
const all = migrations.map((m) => m.sql).join('\n');

// Strip `--` comments so wording in comments never satisfies or fails a check.
const code = (sql) => sql.replace(/--[^\n]*/g, '');

const policies = migrations.flatMap(({ name, sql }) =>
  (code(sql).match(/CREATE\s+POLICY[\s\S]*?;/gi) || []).map((stmt) => ({ name, stmt: stmt.replace(/\s+/g, ' ') })));

const tables = migrations.flatMap(({ name, sql }) =>
  [...code(sql).matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?(\w+)/gi)].map((m) => ({ name, table: m[1] })));

describe('Proof Scan v2 migrations: security', () => {
  it('finds the v2 migrations', () => {
    expect(migrations.map((m) => m.name).sort()).toEqual([
      '2000_proof_scan_security.sql',
      '2001_proof_scan_v2_core.sql',
      '2002_proof_scan_v2_rules.sql',
      '2003_proof_scan_v2_seed.sql',
    ]);
    expect(policies.length).toBeGreaterThan(40);
    expect(tables.length).toBe(13);
  });

  it('never uses USING (true) or WITH CHECK (true) without TO authenticated', () => {
    for (const { name, stmt } of policies) {
      if (/(USING|WITH CHECK)\s*\(\s*true\s*\)/i.test(stmt)) {
        expect(stmt, `${name}: ${stmt}`).toMatch(/\bTO\s+authenticated\b/i);
      }
    }
  });

  it('names a role on every policy, and never anon or public', () => {
    for (const { name, stmt } of policies) {
      expect(stmt, `${name}: ${stmt}`).toMatch(/\bTO\s+authenticated\b/i);
      expect(stmt, `${name}: ${stmt}`).not.toMatch(/\bTO\s+(anon|public)\b/i);
    }
  });

  it('gates every Proof Scan policy on the proof_scan module', () => {
    for (const { name, stmt } of policies) {
      if (/\bON\s+public\.form_editions\b/i.test(stmt)) continue; // public USCIS reference data
      expect(stmt, `${name}: ${stmt}`).toMatch(/public\.can_(read|write)\('proof_scan'\)/);
    }
  });

  it('turns on row level security, revokes anon, and adds a read policy for every new table', () => {
    for (const { name, table } of tables) {
      expect(all, `${name}: ${table} RLS`).toMatch(new RegExp(`ALTER TABLE public\\.${table}\\s+ENABLE ROW LEVEL SECURITY`));
      expect(all, `${name}: ${table} anon`).toMatch(new RegExp(`REVOKE ALL ON TABLE public\\.${table}\\s+FROM anon`));
      expect(policies.some(({ stmt }) => new RegExp(`ON public\\.${table} FOR SELECT TO authenticated USING \\(public\\.can_read\\('proof_scan'\\)\\)`).test(stmt)),
        `${table} read policy`).toBe(true);
    }
  });

  it('2000 drops the open 1300 policies and locks the existing tables', () => {
    const sql = code(migrations.find((m) => m.name.startsWith('2000')).sql);
    for (const p of ['staff_read_form_editions', 'staff_all_proof_scan_config', 'staff_all_proof_scans']) {
      expect(sql).toMatch(new RegExp(`DROP POLICY IF EXISTS "${p}"`));
    }
    for (const t of ['proof_scans', 'proof_scan_config']) {
      for (const op of ['SELECT', 'INSERT', 'UPDATE', 'DELETE']) {
        expect(policies.some(({ stmt }) => stmt.includes(`ON public.${t} FOR ${op} TO authenticated`)), `${t} ${op}`).toBe(true);
      }
    }
    expect(sql).toMatch(/REVOKE ALL ON TABLE public\.form_editions\s+FROM anon/);
  });

  it('stores the SSN encrypted, never in plaintext', () => {
    const core = code(migrations.find((m) => m.name.startsWith('2001')).sql);
    expect(core).toMatch(/ssn_encrypted\s+text/);
    expect(core).toMatch(/ssn_last4\s+char\(4\)/);
    expect(core).not.toMatch(/^\s+ssn\s+text/m);
    // Document facts refuse a full SSN.
    expect(core).toMatch(/proof_scan_documents_no_full_ssn/);
    // D-97: an SSN suggestion is stored encrypted, never in the plaintext value.
    expect(core).toMatch(/value_encrypted\s+text/);
    expect(core).toMatch(/value_last4\s+char\(4\)/);
    expect(core).toMatch(/proof_scan_suggestions_value_shape/);
    expect(core).toMatch(/proof_scan_suggestions_no_plain_ssn/);
  });
});
