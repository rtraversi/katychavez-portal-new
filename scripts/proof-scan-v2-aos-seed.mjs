// proof-scan-v2-aos-seed.mjs: the AOS case type's rule set (v2.1).
//
//   node scripts/proof-scan-v2-aos-seed.mjs          rewrite the generated block in 2006
//   node scripts/proof-scan-v2-aos-seed.mjs --check  exit 1 if the block is stale
//
// Source of truth: functions/api/proof-scan-profiles/v2-aos-seed.json (the firm's
// AOS checklist as decided in D-129 to D-147 and Q-59 to Q-81). The firm-wide
// checks are not in the JSON: the migration copies them from the General case
// type's CURRENT version, so any rulebook edit staff made to them carries over
// (the same approach as 2005). buildAosRuleSet() does the same in memory for the
// tests and the local preview.
//
// Pure functions only at the top level, so the test suite can import them.

export const AOS_SEED_JSON_PATH = 'functions/api/proof-scan-profiles/v2-aos-seed.json';
export const AOS_SQL_PATH = 'supabase/migrations/2006_proof_scan_v2_1.sql';
export const BLOCK_START = '-- ── BEGIN GENERATED: AOS rule set (scripts/proof-scan-v2-aos-seed.mjs) ──';
export const BLOCK_END = '-- ── END GENERATED ──';

const STAGES = ['draft_review', 'preflight', 'physical_scan'];
const lit = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
const int = (v) => {
  if (!Number.isInteger(v)) throw new Error(`Expected an integer, got ${v}`);
  return String(v);
};
const bool = (v) => (v ? 'true' : 'false');
const textArray = (a) => (a.length ? `ARRAY[${a.map(lit).join(', ')}]::text[]` : `'{}'::text[]`);

// The firm-wide rules as 2005 left them (PS-103 retired, PS-306 noted for
// passports), from a General rule set held in memory.
const PS306_NOTE = 'A document not in English needs a certified English translation in the package. Checked at Physical Scan; at Draft Review and Pre-flight only when evidence is part of the files. Decided by Max 2026-10-08 (D-100). Does not apply to passports, which usually carry their own translation (D-124, 2026-10-13).';

export function buildAosRuleSet(generalRuleSet, aosSeed) {
  const firm = generalRuleSet.rules.filter((r) => r.scope === 'firm').map((r) => ({
    ...r,
    stages: structuredClone(r.stages),
    retired: Boolean(r.retired) || r.rule_id === 'PS-103',
    note: r.rule_id === 'PS-306' ? PS306_NOTE : r.note,
  }));
  return {
    case_type: aosSeed.case_type,
    version: aosSeed.version,
    label: aosSeed.label,
    source_note: aosSeed.source_note,
    package_items: aosSeed.package_items.map((i) => ({ instance: null, applies_when: null, missing_confirm: false, ...i })),
    rules: [...firm, ...aosSeed.rules.map((r) => ({ applies_when: null, ...structuredClone(r) }))],
  };
}

const setRef = (s) => `(SELECT id FROM public.proof_scan_rule_sets WHERE case_type = ${lit(s.case_type)} AND version = ${int(s.version)})`;

export function buildAosSeedSql(seed) {
  const ref = setRef(seed);
  const out = [BLOCK_START, ''];
  out.push(
    `-- ${seed.label} v${seed.version}: the firm-wide checks of General's current version, then`,
    `-- ${seed.rules.length} AOS checks and ${seed.package_items.length} package items.`,
    'INSERT INTO public.proof_scan_rule_sets (case_type, version, is_current, label, source_note, created_by)',
    `SELECT ${lit(seed.case_type)}, ${int(seed.version)},`,
    `       NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_sets WHERE case_type = ${lit(seed.case_type)} AND is_current),`,
    `       ${lit(seed.label)}, ${lit(seed.source_note)}, NULL`,
    `WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_sets WHERE case_type = ${lit(seed.case_type)} AND version = ${int(seed.version)});`,
    '',
  );

  seed.package_items.forEach((item, i) => {
    out.push(
      'INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)',
      `SELECT ${ref},`,
      `       ${lit(item.item_id)}, ${lit(item.form)}, ${lit(item.instance)}, ${lit(item.label)}, ${int(item.pages)}, ${lit(item.kind)}, ${int(i + 1)},`,
      `       ${lit(item.applies_when)}, ${bool(item.missing_confirm)}`,
      `WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = ${ref} AND item_id = ${lit(item.item_id)});`,
    );
  });
  out.push('');

  // Firm-wide checks: copied from General's current version, with their stage settings.
  out.push(
    '-- Firm-wide checks (D-93), copied from the General case type\'s current version.',
    'INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,',
    '                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order)',
    `SELECT ${ref}, r.rule_id, r.title, r.severity, r.check_kind, r.form, r.page, r.item, r.expected,`,
    '       r.pass_text, r.note, r.source_note, r.applies_to_item_ids, r.scope, r.origin, r.retired, r.sort_order',
    'FROM public.proof_scan_rules r',
    'JOIN public.proof_scan_rule_sets s ON s.id = r.rule_set_id',
    "WHERE s.case_type = 'general' AND s.is_current AND r.scope = 'firm'",
    `  AND NOT EXISTS (SELECT 1 FROM public.proof_scan_rules x WHERE x.rule_set_id = ${ref} AND x.rule_id = r.rule_id);`,
    'INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)',
    'SELECT a.id, ss.stage, ss.state, ss.stage_title, ss.stage_pass_text, ss.stage_expected, ss.gentle_if_no',
    'FROM public.proof_scan_rules a',
    'JOIN public.proof_scan_rule_sets gs ON gs.case_type = \'general\' AND gs.is_current',
    'JOIN public.proof_scan_rules g ON g.rule_set_id = gs.id AND g.rule_id = a.rule_id',
    'JOIN public.proof_scan_rule_stage_settings ss ON ss.rule_pk = g.id',
    `WHERE a.rule_set_id = ${ref} AND a.scope = 'firm'`,
    '  AND NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings x WHERE x.rule_pk = a.id AND x.stage = ss.stage);',
    '',
  );

  seed.rules.forEach((r, i) => {
    const pk = `(SELECT id FROM public.proof_scan_rules WHERE rule_set_id = ${ref} AND rule_id = ${lit(r.rule_id)})`;
    out.push(
      'INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,',
      '                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)',
      `SELECT ${ref},`,
      `       ${lit(r.rule_id)}, ${lit(r.title)}, ${lit(r.severity)}, ${lit(r.check_kind)},`,
      `       ${lit(r.form)}, ${lit(r.page)}, ${lit(r.item)}, ${lit(r.expected)},`,
      `       ${lit(r.pass_text)}, ${lit(r.note)}, ${lit(r.source_note)}, ${textArray(r.applies_to_item_ids || [])},`,
      `       ${lit(r.scope)}, ${lit(r.origin)}, ${bool(r.retired)}, ${int(100 + i)}, ${lit(r.applies_when)}`,
      `WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = ${ref} AND rule_id = ${lit(r.rule_id)});`,
    );
    for (const stage of STAGES) {
      const s = r.stages[stage];
      out.push(
        'INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)',
        `SELECT ${pk}, ${lit(stage)}, ${lit(s.state)}, ${lit(s.stage_title)}, ${lit(s.stage_pass_text)}, ${lit(s.stage_expected)}, ${bool(s.gentle_if_no)}`,
        `WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = ${pk} AND stage = ${lit(stage)});`,
      );
    }
  });
  out.push('', BLOCK_END);
  return out.join('\n');
}

// The generated block inside the migration file, or null.
export function generatedBlock(sql) {
  const a = sql.indexOf(BLOCK_START);
  const b = sql.indexOf(BLOCK_END);
  return a >= 0 && b > a ? sql.slice(a, b + BLOCK_END.length) : null;
}

const isMain = typeof process !== 'undefined'
  && Array.isArray(process.argv)
  && /proof-scan-v2-aos-seed\.mjs$/.test(process.argv[1] || '');

if (isMain) {
  const fs = await import('node:fs');
  const path = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const seed = JSON.parse(fs.readFileSync(path.join(root, AOS_SEED_JSON_PATH), 'utf8'));
  const block = buildAosSeedSql(seed);
  const target = path.join(root, AOS_SQL_PATH);
  const current = fs.readFileSync(target, 'utf8');
  const old = generatedBlock(current);
  if (!old) {
    console.error(`${AOS_SQL_PATH} has no generated block markers.`);
    process.exit(1);
  }
  if (process.argv.includes('--check')) {
    if (old !== block) {
      console.error(`${AOS_SQL_PATH} is out of date. Run: node scripts/proof-scan-v2-aos-seed.mjs`);
      process.exit(1);
    }
    console.log(`${AOS_SQL_PATH} is up to date.`);
  } else {
    fs.writeFileSync(target, current.replace(old, block));
    console.log(`Wrote the generated block in ${AOS_SQL_PATH}`);
  }
}
