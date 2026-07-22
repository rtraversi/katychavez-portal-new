#!/usr/bin/env node
// The columns available to a field map, derived live from the migrations.
//
// Authoring a field map means writing sources like "client.last_name" — but the
// columns behind each fill source are spread across the base CREATE TABLEs and
// dozens of later ALTER TABLE ADD COLUMN migrations, and a contributor has no
// database access to inspect them. Guessing produces "client.lastname", which
// resolves to undefined and silently fills nothing.
//
// This reads the migrations directly rather than shipping a checked-in list, so
// it cannot go stale.
//
// Usage:
//   node scripts/fill-sources.js              # every fill source and its columns
//   node scripts/fill-sources.js client       # just one
//
// Consumed by scripts/validate-field-map.js to warn on unknown columns.

'use strict';

const fs   = require('fs');
const path = require('path');

const MIGRATIONS_DIR = path.join(__dirname, '..', 'supabase', 'migrations');

// Fill-source prefix -> the table behind it. Mirrors the context assembled in
// functions/api/form-filler-generate.js and consumed by resolvePath().
const SOURCE_TABLE = {
  client:        'clients',
  matter:        'matters',
  immigration:   'client_immigration',
  petitioner:    'opposing_parties',
  joint_sponsor: 'opposing_parties',
  firm:          'firm_settings',
  attorney:      'users',
};

// Not real columns — resolvePath() synthesizes these.
const VIRTUAL = {
  client:        ['ssn_full'],
  petitioner:    ['ssn_full', 'full_name'],
  joint_sponsor: ['ssn_full', 'full_name'],
  attorney:      ['full_name'],
};

// Line-leading words in a CREATE TABLE body that introduce a constraint, not a column.
const NOT_A_COLUMN = new Set([
  'primary', 'unique', 'constraint', 'foreign', 'check', 'exclude', 'like', 'partition',
]);

function collectColumns() {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter(f => f.endsWith('.sql')).sort();
  const tables = {}; // table -> Set(columns)

  const ensure = (t) => (tables[t] = tables[t] || new Set());

  for (const file of files) {
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf8');

    // ── CREATE TABLE public.<t> ( ... ); ───────────────────────────────────
    const createRe = /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:public\.)?(\w+)\s*\(([\s\S]*?)\n\s*\)\s*;/gi;
    for (const m of sql.matchAll(createRe)) {
      const cols = ensure(m[1]);
      for (const rawLine of m[2].split('\n')) {
        const line = rawLine.trim();
        if (!line || line.startsWith('--')) continue;
        const nameMatch = line.match(/^([a-z_][a-z0-9_]*)\s+\S/i);
        if (!nameMatch) continue;
        if (NOT_A_COLUMN.has(nameMatch[1].toLowerCase())) continue;
        cols.add(nameMatch[1]);
      }
    }

    // ── ALTER TABLE public.<t> ADD/DROP/RENAME COLUMN ... ; ────────────────
    const alterRe = /ALTER TABLE\s+(?:IF EXISTS\s+)?(?:public\.)?(\w+)([\s\S]*?);/gi;
    for (const m of sql.matchAll(alterRe)) {
      const cols = ensure(m[1]);
      const body = m[2];
      for (const a of body.matchAll(/ADD COLUMN(?:\s+IF NOT EXISTS)?\s+(\w+)/gi)) cols.add(a[1]);
      for (const d of body.matchAll(/DROP COLUMN(?:\s+IF EXISTS)?\s+(\w+)/gi)) cols.delete(d[1]);
      for (const r of body.matchAll(/RENAME COLUMN\s+(\w+)\s+TO\s+(\w+)/gi)) {
        cols.delete(r[1]);
        cols.add(r[2]);
      }
    }
  }

  const out = {};
  for (const [prefix, table] of Object.entries(SOURCE_TABLE)) {
    const cols = new Set(tables[table] || []);
    for (const v of VIRTUAL[prefix] || []) cols.add(v);
    out[prefix] = { table, columns: [...cols].sort() };
  }
  return out;
}

function main() {
  const only = process.argv.slice(2).find(a => !a.startsWith('--'));
  const sources = collectColumns();

  if (only && !sources[only]) {
    console.error(`Unknown fill source "${only}". Valid: ${Object.keys(sources).join(', ')}`);
    process.exit(1);
  }

  console.log('\n=== Fill sources available to a field map ===');
  console.log('Derived from supabase/migrations. Use as "<prefix>.<column>", e.g. client.last_name\n');

  for (const [prefix, { table, columns }] of Object.entries(sources)) {
    if (only && prefix !== only) continue;
    console.log(`  ${prefix}.*  (${table}) — ${columns.length} columns`);
    // Wrap at a readable width rather than one per line.
    let line = '     ';
    for (const c of columns) {
      if ((line + c).length > 96) { console.log(line); line = '     '; }
      line += c + '  ';
    }
    if (line.trim()) console.log(line);
    console.log('');
  }

  console.log('  Also: literal:<value> for a fixed value, and blank to leave a field empty.');
  console.log('  immigration.family.<n>.<column> reads the nth family member.\n');
  console.log('  A column you need but do not see here does not exist yet — escalate,');
  console.log('  do not add it yourself. See USCIS-FORM-PREP-PROCESS.md section 6.\n');
}

module.exports = { collectColumns, SOURCE_TABLE };

if (require.main === module) main();
