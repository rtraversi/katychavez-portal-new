#!/usr/bin/env node
// One-command prep for adding a new USCIS form to the form-filler library.
//
// Runs the whole read-only half of the pipeline so a contributor never has to
// touch R2, Supabase, or Cloudflare:
//
//   1. normalize   -> normalized/<key>.pdf + normalized/<key>.fields.json
//                     (delegates to scripts/normalize-form-template.js WITHOUT
//                      --upload, so no credentials are ever needed)
//   2. tooltips    -> normalized/<key>.tooltips.tsv
//                     every field's authoritative USCIS semantics (the TU
//                     tooltip, e.g. "Part 1. Item Number 4.c. Select Suite."),
//                     plus type and maxLength. NEVER guess a field's meaning
//                     from its name -- read this file.
//   3. scaffold    -> supabase/migrations/1600-<formid>.sql
//                     a complete starter migration with EVERY field already
//                     listed as "blank". The job is then to change the fields
//                     that should autofill -- not to hand-type field names,
//                     which is where silent typos come from.
//
// Usage:
//   node scripts/prep-form.js i-864
//   node scripts/prep-form.js i-864 --force   # overwrite an existing scaffold
//
// Then edit the migration, and check your work with:
//   node scripts/validate-field-map.js i-864
//
// See USCIS-FORM-PREP-PROCESS.md for the full process.

'use strict';

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT           = path.join(__dirname, '..');
const RAW_DIR        = path.join(ROOT, 'uscis-forms');
const NORMALIZED_DIR = path.join(ROOT, 'normalized');
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');

// 1600-<formid>.sql — form id drops the hyphen: i-864 -> i864, i-765ws -> i765ws.
const formId = (formKey) => formKey.replace(/-/g, '');

async function main() {
  const args    = process.argv.slice(2);
  const formKey = args.find(a => !a.startsWith('--'));
  const force   = args.includes('--force');

  if (!formKey) {
    console.error('Usage: node scripts/prep-form.js <form-key> [--force]');
    console.error('  form-key is lowercase, hyphenated, exactly as USCIS names it: i-864, i-130, g-28');
    process.exit(1);
  }

  const rawPath = path.join(RAW_DIR, `${formKey}.pdf`);
  if (!fs.existsSync(rawPath)) {
    console.error(`\n  Source PDF not found: ${rawPath}`);
    console.error(`  Download the official fillable PDF from https://www.uscis.gov/forms/all-forms`);
    console.error(`  and save it as uscis-forms/${formKey}.pdf\n`);
    process.exit(1);
  }

  console.log(`\n=== Preparing ${formKey} ===\n`);

  // ── Source fingerprint ─────────────────────────────────────────────────────
  // Rob re-normalizes on his own machine before uploading to R2. If his source
  // PDF is a different USCIS edition than the one mapped here, field names can
  // differ and the map silently misfires. This hash lets him verify the source
  // is byte-identical. It belongs in the migration header and the PR.
  const crypto = require('crypto');
  const rawBytes = fs.readFileSync(rawPath);
  const sha256 = crypto.createHash('sha256').update(rawBytes).digest('hex');

  // ── Step 1: normalize (delegated, never with --upload) ─────────────────────
  console.log('[1/3] Normalizing...');
  execFileSync(process.execPath,
    [path.join(__dirname, 'normalize-form-template.js'), formKey],
    { stdio: 'inherit', cwd: ROOT });

  const fieldsJsonPath = path.join(NORMALIZED_DIR, `${formKey}.fields.json`);
  const fields = JSON.parse(fs.readFileSync(fieldsJsonPath, 'utf8'));

  // ── Step 2: tooltip dump ───────────────────────────────────────────────────
  console.log('\n[2/3] Dumping field semantics...');
  const tooltips = await dumpTooltips(rawPath);

  const tsvPath = path.join(NORMALIZED_DIR, `${formKey}.tooltips.tsv`);
  const tsv = ['field_name\ttype\tmax_length\tuscis_tooltip']
    .concat(fields.map(f => {
      const t = tooltips[f.name] || {};
      return [f.name, f.type, t.maxLength ?? '', (t.tooltip || '').replace(/\s+/g, ' ').trim()].join('\t');
    }))
    .join('\n');
  fs.writeFileSync(tsvPath, tsv);

  const withTooltips = fields.filter(f => tooltips[f.name]?.tooltip).length;
  console.log(`      Wrote ${tsvPath}`);
  console.log(`      ${withTooltips}/${fields.length} fields carry a USCIS tooltip`);

  // ── Step 3: scaffold the migration ─────────────────────────────────────────
  console.log('\n[3/3] Scaffolding migration...');
  const migPath = path.join(MIGRATIONS_DIR, `1600-${formId(formKey)}.sql`);

  if (fs.existsSync(migPath) && !force) {
    console.log(`      SKIPPED — ${path.basename(migPath)} already exists.`);
    console.log(`      Pass --force to overwrite (this DISCARDS any mapping work in it).`);
  } else {
    fs.writeFileSync(migPath, buildScaffold({ formKey, fields, tooltips, sha256 }));
    console.log(`      Wrote ${migPath}`);
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const byType = {};
  fields.forEach(f => { byType[f.type] = (byType[f.type] || 0) + 1; });

  console.log(`\n=== ${formKey} ready ===`);
  console.log(`  Fields:  ${fields.length}  (${Object.entries(byType).map(([k, v]) => `${k} ${v}`).join(', ')})`);
  console.log(`  SHA-256: ${sha256}`);
  console.log(`\n  Record the SHA-256 and the form's edition date (printed lower-left on the`);
  console.log(`  PDF) in the migration header -- both are required in the PR.\n`);
  console.log(`  Next:`);
  console.log(`    1. Open normalized/${formKey}.pdf — confirm it is fillable, no password prompt,`);
  console.log(`       and barcodes render as barcodes (not raw text). If not, STOP and escalate.`);
  console.log(`    2. Open normalized/${formKey}.tooltips.tsv alongside`);
  console.log(`       supabase/migrations/1600-${formId(formKey)}.sql and change "blank" to a real`);
  console.log(`       source for every field that should autofill.`);
  console.log(`    3. node scripts/validate-field-map.js ${formKey}\n`);
}

// Reads the TU (tooltip) entry every USCIS field carries — the authoritative
// description of what the field means. Read from the RAW pdf: normalization
// preserves TU, but reading the original keeps this independent of it.
async function dumpTooltips(rawPath) {
  const { PDFDocument, PDFName } = require('@cantoo/pdf-lib');
  const doc = await PDFDocument.load(fs.readFileSync(rawPath),
    { ignoreEncryption: true, password: '' });

  const out = {};
  for (const f of doc.getForm().getFields()) {
    let tooltip = '';
    try {
      const tu = f.acroField.dict.lookup(PDFName.of('TU'));
      if (tu && typeof tu.decodeText === 'function') tooltip = tu.decodeText();
    } catch (_) { /* no tooltip on this field */ }

    let maxLength;
    try {
      if (typeof f.getMaxLength === 'function') maxLength = f.getMaxLength();
    } catch (_) { /* not a text field */ }

    out[f.getName()] = { tooltip, maxLength };
  }
  return out;
}

// pdf-lib field class -> the "type" a field_map entry declares.
// RadioGroup/Signature/Button have no autofill path in applyFieldMap, so they
// scaffold as text and must stay "blank" — the validator enforces that.
const TYPE_FOR = { TextField: 'text', CheckBox: 'checkbox', Dropdown: 'dropdown' };

function buildScaffold({ formKey, fields, tooltips, sha256 }) {
  const entries = fields.map(f => {
    const tooltip = (tooltips[f.name]?.tooltip || '').replace(/\s+/g, ' ').trim();
    return {
      name: f.name,
      type: TYPE_FOR[f.type] || 'text',
      pdfType: f.type,
      tooltip,
    };
  });

  // JSON can't carry comments, so the tooltips live in the .tooltips.tsv
  // companion file rather than inline here.
  const fieldMap = {};
  for (const e of entries) fieldMap[e.name] = { type: e.type, source: 'blank' };

  // Single quotes must be doubled inside a SQL string literal.
  const fieldMapSql = JSON.stringify(fieldMap, null, 2).replace(/'/g, "''");

  const byType = {};
  entries.forEach(e => { byType[e.pdfType] = (byType[e.pdfType] || 0) + 1; });

  return `-- Migration 1600-${formId(formKey)}: ${formKey.toUpperCase()} field map + template registration
--
-- TODO: one-paragraph description of the form and what it is used for.
--
-- Source:  uscis-forms/${formKey}.pdf
-- Edition: TODO -- the edition date printed lower-left on the PDF, e.g. 04/01/24
-- SHA-256: ${sha256}
--
-- ${entries.length} field(s): ${Object.entries(byType).map(([k, v]) => `${v} ${k}`).join(', ')}.
-- Field inventory: normalized/${formKey}.fields.json
-- Field semantics: normalized/${formKey}.tooltips.tsv
--
-- TODO: document the mapping decisions here, following 1600-n400.sql's header.
-- Explain in particular anything deliberately left blank that a reader might
-- expect to be filled, and any value that needed a data column or transform
-- that does not exist yet.
--
-- SCAFFOLD: every field below is currently "blank". Change "source" to a real
-- fill source for each field that should autofill. Leave signatures,
-- attestations, payment fields, and narrative/eligibility judgment calls blank.
-- See USCIS-FORM-PREP-PROCESS.md section 4 for the full source and transform list.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('${formKey}', 'Form ${formKey.toUpperCase()} -- TODO: full official title')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key      = 'form-templates/${formKey}.pdf',
    field_count = ${entries.length},
    field_map   = '${fieldMapSql}'::jsonb
WHERE form_key = '${formKey}';
`;
}

main().catch(err => {
  console.error('\n[prep-form] Failed:', err.message);
  process.exit(1);
});
