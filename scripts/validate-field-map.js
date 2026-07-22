#!/usr/bin/env node
// Validates a 1600-<formid>.sql field map against the normalized field inventory.
//
// A mistyped field name is the worst failure mode in this module: it does not
// error, it silently does nothing, and the missing value only surfaces when
// someone reviews a generated form -- or doesn't. This script makes that class
// of mistake impossible to ship.
//
// Checks:
//   ERROR   mapped field name not present in the PDF
//   ERROR   declared type disagrees with the actual PDF field type
//   ERROR   unknown source prefix or unknown transform
//   ERROR   field type that cannot autofill (RadioGroup/Signature/Button)
//           given a non-blank source
//   ERROR   scaffold TODO placeholders left in the migration
//   WARN    PDF field present in the inventory but absent from the map
//   WARN    a field that looks like a signature has a non-blank source
//
// Usage:
//   node scripts/validate-field-map.js i-864
//
// Exits non-zero if any ERROR is found. See USCIS-FORM-PREP-PROCESS.md.

'use strict';

const fs   = require('fs');
const path = require('path');

const ROOT           = path.join(__dirname, '..');
const NORMALIZED_DIR = path.join(ROOT, 'normalized');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');

const formId = (formKey) => formKey.replace(/-/g, '');

// Fill-source prefixes understood by resolvePath() in functions/api/_form-fill.js.
// Adding one is a shared-code change -- escalate, don't extend this list.
const SOURCE_PREFIXES = [
  'client', 'matter', 'immigration', 'firm', 'attorney', 'petitioner', 'joint_sponsor',
];

// pdf-lib field class -> the type a field_map entry must declare.
const TYPE_FOR = { TextField: 'text', CheckBox: 'checkbox', Dropdown: 'dropdown' };

function main() {
  const formKey = process.argv.slice(2).find(a => !a.startsWith('--'));
  if (!formKey) {
    console.error('Usage: node scripts/validate-field-map.js <form-key>');
    process.exit(1);
  }

  // A form can have more than one migration touching its map (a base map plus
  // later patches, e.g. 1600-g28.sql and 1600-g28-atty-fields.sql), so allow
  // pointing at one explicitly.
  const migArg = process.argv.slice(2).find(a => a.startsWith('--migration='));

  const fieldsJsonPath = path.join(NORMALIZED_DIR, `${formKey}.fields.json`);
  const migPath        = migArg
    ? path.resolve(ROOT, migArg.slice('--migration='.length))
    : path.join(MIGRATIONS_DIR, `1600-${formId(formKey)}.sql`);

  for (const [label, p] of [['Field inventory', fieldsJsonPath], ['Migration', migPath]]) {
    if (!fs.existsSync(p)) {
      console.error(`\n  ${label} not found: ${p}`);
      console.error(`  Run: node scripts/prep-form.js ${formKey}\n`);
      process.exit(1);
    }
  }

  const inventory = JSON.parse(fs.readFileSync(fieldsJsonPath, 'utf8'));
  const sql       = fs.readFileSync(migPath, 'utf8');
  const transforms = knownTransforms();

  const byName = new Map(inventory.map(f => [f.name, f.type]));
  const { fieldMap, isPatch } = extractFieldMap(sql, migPath);
  const fillSources = require('./fill-sources.js').collectColumns();

  const errors = [];
  const warns  = [];

  // ── Scaffold placeholders left behind ──────────────────────────────────────
  const todoLines = sql.split('\n')
    .map((line, i) => ({ line: line.trim(), n: i + 1 }))
    .filter(x => x.line.includes('TODO'));
  for (const t of todoLines) {
    errors.push(`${path.basename(migPath)}:${t.n} — scaffold placeholder not filled in: ${t.line.slice(0, 90)}`);
  }

  // ── Per-entry checks ───────────────────────────────────────────────────────
  const counts = { mapped: 0, literal: 0, blank: 0 };

  for (const [name, descriptor] of Object.entries(fieldMap)) {
    const actualType = byName.get(name);

    if (actualType === undefined) {
      errors.push(`field not present in ${formKey}: "${name}"`);
      continue;
    }

    const source = descriptor.source;
    if (typeof source !== 'string') {
      errors.push(`"${name}": missing or non-string "source"`);
      continue;
    }

    const isBlank   = source === 'blank';
    const isLiteral = source.startsWith('literal:');

    if (isBlank) counts.blank++;
    else if (isLiteral) counts.literal++;
    else counts.mapped++;

    // Type agreement. Only meaningful for entries that actually fill: a blank
    // entry never reaches the type switch in applyFieldMap.
    const expectedType = TYPE_FOR[actualType];
    if (!isBlank) {
      if (!expectedType) {
        errors.push(`"${name}": ${actualType} cannot be autofilled — source must be "blank" (got "${source}")`);
      } else if (descriptor.type !== expectedType) {
        errors.push(`"${name}": declared type "${descriptor.type}" but the PDF field is a ${actualType} (expected "${expectedType}")`);
      }
    }

    // Source prefix, then the column behind it.
    if (!isBlank && !isLiteral) {
      const prefix = source.split('.')[0];
      const rest   = source.slice(prefix.length + 1);

      if (!SOURCE_PREFIXES.includes(prefix)) {
        errors.push(`"${name}": unknown source prefix "${prefix}" in "${source}" (valid: ${SOURCE_PREFIXES.join(', ')}, literal:, blank)`);
      } else if (!source.includes('.')) {
        errors.push(`"${name}": source "${source}" has no column — expected "${prefix}.<column>"`);
      } else if (prefix === 'immigration' && rest.startsWith('family.')) {
        // immigration.family.<n>.<col> reads a separate per-member record —
        // not covered by the fill-source column inventory.
      } else if (fillSources[prefix] && !fillSources[prefix].columns.includes(rest)) {
        // Warning, not an error: the column inventory is parsed out of the
        // migrations, so an exotic DDL shape could produce a false negative.
        // A real typo here fills nothing and raises no runtime error, which is
        // exactly why it is worth flagging.
        warns.push(`"${name}": column "${rest}" not found on ${prefix}.* (${fillSources[prefix].table}) — check spelling against: node scripts/fill-sources.js ${prefix}`);
      }
    }

    // Transform.
    if (descriptor.transform && !transforms.includes(descriptor.transform)) {
      errors.push(`"${name}": unknown transform "${descriptor.transform}" (valid: ${transforms.join(', ')})`);
    }

    // Signature safety net — signatures are never autofilled.
    if (!isBlank && /signature|_sig\b|sig\[/i.test(name)) {
      warns.push(`"${name}" looks like a signature field but has source "${source}" — signatures must stay blank`);
    }
  }

  // ── Coverage: every PDF field should be accounted for ──────────────────────
  // Patch migrations (field_map || '{...}') amend an existing map by design,
  // so partial coverage is correct there and coverage is not checked.
  if (!isPatch) {
    const unmapped = inventory.filter(f => !(f.name in fieldMap));
    for (const f of unmapped) {
      warns.push(`field present in the PDF but absent from the map: "${f.name}" (${f.type}) — add it with source "blank" if intentional`);
    }
  }

  // ── Report ─────────────────────────────────────────────────────────────────
  console.log(`\n=== ${formKey} — field map validation ===${isPatch ? '\n\n  (patch migration — amends an existing map; coverage not checked)' : ''}\n`);
  console.log(`  PDF fields:      ${inventory.length}`);
  console.log(`  Map entries:     ${Object.keys(fieldMap).length}`);
  console.log(`    data-mapped:   ${counts.mapped}`);
  console.log(`    literal:       ${counts.literal}`);
  console.log(`    blank:         ${counts.blank}`);

  if (warns.length) {
    console.log(`\n  WARNINGS (${warns.length}):`);
    warns.forEach(w => console.log(`    ! ${w}`));
  }

  if (errors.length) {
    console.log(`\n  ERRORS (${errors.length}):`);
    errors.forEach(e => console.log(`    x ${e}`));
    console.log(`\n  FAILED — fix the errors above before opening a PR.\n`);
    process.exit(1);
  }

  console.log(`\n  PASSED${warns.length ? ' (with warnings — review them)' : ''}.`);
  console.log(`\n  For the PR description:`);
  console.log(`    ${inventory.length} fields — ${counts.mapped} data-mapped, ${counts.literal} literal, ${counts.blank} deliberately blank.\n`);
}

// Pulls the field_map jsonb literal out of the migration and parses it.
// Two shapes are supported:
//   field_map = '{...}'::jsonb                 full map (what prep-form.js scaffolds)
//   field_map = field_map || '{...}'::jsonb    patch amending an existing map
function extractFieldMap(sql, migPath) {
  const patch = sql.match(/field_map\s*=\s*field_map\s*\|\|\s*'([\s\S]*?)'::jsonb/);
  const full  = patch ? null : sql.match(/field_map\s*=\s*'([\s\S]*?)'::jsonb/);
  const m     = patch || full;

  if (!m) {
    console.error(`\n  Could not find a field_map assignment in ${path.basename(migPath)}.`);
    console.error(`  Expected either:`);
    console.error(`    field_map = '{...}'::jsonb                  (full map)`);
    console.error(`    field_map = field_map || '{...}'::jsonb     (patch)\n`);
    process.exit(1);
  }

  // Undo SQL single-quote escaping.
  const json = m[1].replace(/''/g, "'");
  try {
    return { fieldMap: JSON.parse(json), isPatch: Boolean(patch) };
  } catch (err) {
    console.error(`\n  field_map is not valid JSON: ${err.message}`);
    console.error(`  A stray comma or unbalanced brace is the usual cause.\n`);
    process.exit(1);
  }
}

// Reads the transform names straight out of applyTransform() so this validator
// cannot drift from the resolver the way the old hand-copied test harness did.
function knownTransforms() {
  const src = fs.readFileSync(path.join(ROOT, 'functions', 'api', '_form-fill.js'), 'utf8');
  const start = src.indexOf('export function applyTransform');
  const end   = src.indexOf('export function resolvePath');
  if (start === -1 || end === -1) {
    console.warn('[validate-field-map] Could not locate applyTransform() — transform names unchecked.');
    return [];
  }
  return [...src.slice(start, end).matchAll(/case '([a-z0-9_]+)':/g)].map(m => m[1]);
}

main();
