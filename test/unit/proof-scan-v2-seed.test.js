import { describe, expect, it } from 'vitest';
import seed from '../../functions/api/proof-scan-profiles/v2-seed.json';
import v12 from '../../functions/api/proof-scan-profiles/daca-renewal.v1.json';
import { buildSeedSql } from '../../scripts/proof-scan-v2-seed.mjs';

const seedSql = Object.values(import.meta.glob('../../supabase/migrations/2003_proof_scan_v2_seed.sql', {
  query: '?raw', import: 'default', eager: true,
}))[0];

const REVIEW_STAGES = ['draft_review', 'preflight', 'physical_scan'];
const STATES = ['checked', 'if_filled', 'if_marked', 'later', 'not_this_stage'];
const FIRM_WIDE = ['PS-101', 'PS-102', 'PS-103', 'PS-201', 'PS-301', 'PS-302', 'PS-303'];

const ruleSet = (caseType) => seed.rule_sets.find((rs) => rs.case_type === caseType);
const daca = ruleSet('daca_renewal');
const general = ruleSet('general');
const rule = (rs, id) => rs.rules.find((r) => r.rule_id === id);
const allRules = () => seed.rule_sets.flatMap((rs) => rs.rules.map((r) => [rs.case_type, r]));

describe('Proof Scan v2 seed: DACA renewal', () => {
  it('has exactly the 39 v1.2 checks, same IDs, same order', () => {
    expect(daca.rules).toHaveLength(39);
    expect(daca.rules.map((r) => r.rule_id)).toEqual(v12.rules.map((r) => r.rule_id));
  });

  it('has exactly the 8 v1.2 package items, unchanged', () => {
    expect(daca.package_items).toHaveLength(8);
    expect(daca.package_items).toEqual(v12.package_items);
  });

  it('copies every v1.2 check unchanged', () => {
    for (const old of v12.rules) {
      const r = rule(daca, old.rule_id);
      expect(r.title).toBe(old.title);
      expect(r.severity).toBe(old.severity);
      expect(r.check_kind).toBe(old.check);
      for (const k of ['form', 'page', 'item', 'expected', 'pass_text', 'note', 'source_note']) {
        expect(r[k], `${old.rule_id}.${k}`).toBe(old[k] == null ? undefined : String(old[k]));
      }
      expect(r.applies_to_item_ids).toEqual(old.applies_to_item_ids || []);
      expect(r.scope).toBe(old.scope === 'base' ? 'firm' : 'case_type');
    }
  });

  it('points every package dependency at a real package item', () => {
    const items = new Set(daca.package_items.map((i) => i.item_id));
    for (const r of daca.rules) for (const id of r.applies_to_item_ids) expect(items.has(id), `${r.rule_id} -> ${id}`).toBe(true);
  });
});

describe('Proof Scan v2 seed: General (D-90 to D-95)', () => {
  it('has exactly the 7 firm-wide checks', () => {
    expect(general.rules.map((r) => r.rule_id).sort()).toEqual([...FIRM_WIDE].sort());
    expect(general.rules.every((r) => r.scope === 'firm')).toBe(true);
  });

  it('has no package items', () => {
    expect(general.package_items).toEqual([]);
  });

  it("uses the same stage settings as DACA's firm-wide checks (D-93)", () => {
    for (const r of general.rules) expect(r.stages, r.rule_id).toEqual(rule(daca, r.rule_id).stages);
  });

  it('the DACA firm-wide checks are exactly the same 7', () => {
    expect(daca.rules.filter((r) => r.scope === 'firm').map((r) => r.rule_id).sort()).toEqual([...FIRM_WIDE].sort());
  });
});

describe('Proof Scan v2 seed: stage settings', () => {
  it('every rule has a valid setting for draft_review, preflight and physical_scan', () => {
    expect(seed.stages).toEqual(REVIEW_STAGES);
    for (const [ct, r] of allRules()) {
      expect(Object.keys(r.stages).sort(), `${ct} ${r.rule_id}`).toEqual([...REVIEW_STAGES].sort());
      for (const stage of REVIEW_STAGES) expect(STATES, `${ct} ${r.rule_id} ${stage}`).toContain(r.stages[stage].state);
    }
  });

  it('every Physical Scan setting is "checked" (D-58)', () => {
    for (const [ct, r] of allRules()) expect(r.stages.physical_scan.state, `${ct} ${r.rule_id}`).toBe('checked');
  });

  it('gentle_if_no appears at Draft Review only (D-70)', () => {
    for (const [, r] of allRules()) {
      expect(r.stages.preflight.gentle_if_no).toBeUndefined();
      expect(r.stages.physical_scan.gentle_if_no).toBeUndefined();
    }
  });

  it('signatures wait for Pre-flight at Draft Review (D-69, D-70)', () => {
    for (const id of ['PS-201', 'DACA-G28-004', 'DACA-821D-010', 'DACA-765-009', 'DACA-G1450-006']) {
      expect(rule(daca, id).stages.draft_review.state, id).toBe('later');
      expect(rule(daca, id).stages.preflight.state, id).toBe('checked');
    }
  });

  it('G-1450 card and cardholder details wait for Pre-flight (D-69)', () => {
    for (const id of ['DACA-G1450-004', 'DACA-G1450-005']) {
      expect(rule(daca, id).stages.draft_review.state).toBe('later');
      expect(rule(daca, id).stages.preflight.state).toBe('checked');
    }
  });

  it("G-28 item 3, EAD home or office, is 'if_filled' at Draft Review (D-70)", () => {
    expect(rule(daca, 'DACA-G28-003').stages.draft_review.state).toBe('if_filled');
  });

  it("I-821D departures wait at Draft Review and are 'if_marked' at Pre-flight (D-70, D-71)", () => {
    const r = rule(daca, 'DACA-821D-007');
    expect(r.stages.draft_review.state).toBe('later');
    expect(r.stages.preflight.state).toBe('if_marked');
  });

  it('English questions are gentle at Draft Review only (D-70)', () => {
    const gentle = daca.rules.filter((r) => r.stages.draft_review.gentle_if_no).map((r) => r.rule_id);
    expect(gentle.sort()).toEqual(['DACA-765-008', 'DACA-821D-009']);
    for (const id of gentle) {
      expect(rule(daca, id).stages.draft_review.state).toBe('checked');
      expect(rule(daca, id).stages.physical_scan.gentle_if_no).toBeUndefined();
    }
  });

  it('I-765WS checks only the firm template sentence at Draft Review (D-69)', () => {
    const s = rule(daca, 'DACA-765WS-001').stages.draft_review;
    expect(s.state).toBe('checked');
    expect(s.stage_title).toContain('I have to work to pay for my living expenses.');
    expect(s.stage_expected).toContain('I have to work to pay for my living expenses.');
    expect(rule(daca, 'DACA-765WS-001').stages.physical_scan.stage_title).toBeUndefined();
  });

  it('page order is within a form only at Draft Review (D-58, D-69)', () => {
    expect(rule(daca, 'DACA-ASM-001').stages.draft_review.stage_title).toBe('Pages within each form are in order.');
  });

  it('Pre-flight runs signatures, card details and name / A-Number / address consistency, nothing else (D-71, D-72)', () => {
    const on = daca.rules.filter((r) => r.stages.preflight.state === 'checked').map((r) => r.rule_id).sort();
    expect(on).toEqual([
      'DACA-765-009', 'DACA-821D-010', 'DACA-G1450-004', 'DACA-G1450-005', 'DACA-G1450-006',
      'DACA-G28-004', 'PS-201', 'PS-301', 'PS-302', 'PS-303',
    ]);
    const conditional = daca.rules.filter((r) => r.stages.preflight.state === 'if_marked').map((r) => r.rule_id);
    expect(conditional).toEqual(['DACA-821D-007']);
  });

  it('carries no em dashes in any wording', () => {
    expect(JSON.stringify(seed)).not.toContain('—');
  });
});

describe('Proof Scan v2 seed: generated SQL (2003)', () => {
  it('is up to date with v2-seed.json', () => {
    expect(seedSql).toBe(buildSeedSql(seed));
  });

  it('inserts every rule and one stage setting per rule and stage', () => {
    const ruleCount = seed.rule_sets.reduce((n, rs) => n + rs.rules.length, 0);
    expect(seedSql.match(/INSERT INTO public\.proof_scan_rules /g)).toHaveLength(ruleCount);
    expect(seedSql.match(/INSERT INTO public\.proof_scan_rule_stage_settings /g)).toHaveLength(ruleCount * 3);
    expect(seedSql.match(/INSERT INTO public\.proof_scan_package_items /g)).toHaveLength(8);
  });

  it('guards every insert so a rerun is a no-op', () => {
    const inserts = seedSql.split(/(?=INSERT INTO)/).filter((s) => s.startsWith('INSERT INTO'));
    expect(inserts.length).toBeGreaterThan(0);
    for (const stmt of inserts) expect(stmt).toMatch(/WHERE NOT EXISTS/);
    expect(seedSql).not.toMatch(/\bUPDATE\b|\bDELETE\b|ON CONFLICT/);
  });

  it('escapes quotes in wording', () => {
    expect(buildSeedSql({
      stages: [],
      rule_sets: [{ case_type: 'general', version: 1, label: "O'Brien", source_note: null, package_items: [], rules: [] }],
    })).toContain("'O''Brien'");
  });
});
