// Build the NC will / trust templates from scripts/ep/src/*.md.
//
//   node scripts/ep/build-plan-templates.mjs
//
// Source format (deliberately tiny — enough for an instrument, nothing more):
//   @key / @name / @description / @source   header lines
//   # Title            centred bold title
//   ## Heading         bold heading
//   - item             bullet
//   | a | b | c |      table row (first row of a table is the header)
//   @sig Label         blank space, a signature line, then Label under it
//   @pagebreak
//   **bold**           inline bold; everything else is a plain paragraph
//   {{tag}}            merge tag (functions/api/_ep-merge-context.js contract)
//   [BRACKETS]         left as-is: an attorney choice, never filled
//
// Each text segment becomes ONE TextRun, so a {{tag}} can never be split across
// runs (the Rondinelli lesson). Output:
//   scripts/ep/out/<key>.docx, <key>.filled.docx   (open these in Word)
//   functions/api/_ep-plan-templates.js            (base64, installed by ep-draft.js)
// and the script fails if a template uses a tag the merge context doesn't define,
// if any {{ survives a render, or if a fixture name doesn't come through.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType, PageBreak,
  Table, TableRow, TableCell, WidthType, BorderStyle,
} from 'docx';
import PizZip from 'pizzip';
import Docxtemplater from 'docxtemplater';
import { buildEstateContext, contextKeys, BLANK } from '../../functions/api/_ep-merge-context.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const srcDir = path.join(here, 'src');
const outDir = path.join(here, 'out');
fs.mkdirSync(outDir, { recursive: true });

const FONT = 'Times New Roman';
const SIZE = 24; // half-points → 12pt

function runs(text, base = {}) {
  // Split on **bold** markers; each piece is a single run.
  const parts = String(text).split(/(\*\*[^*]+\*\*)/).filter(Boolean);
  return parts.map(p => p.startsWith('**') && p.endsWith('**')
    ? new TextRun({ text: p.slice(2, -2), bold: true, font: FONT, size: SIZE, ...base })
    : new TextRun({ text: p, font: FONT, size: SIZE, ...base }));
}

function para(text, opts = {}) {
  return new Paragraph({ children: runs(text, opts.run), spacing: { after: 160, line: 276 }, ...opts.p });
}

function cell(text, header) {
  return new TableCell({
    width: { size: 33, type: WidthType.PERCENTAGE },
    children: [new Paragraph({ children: runs(text.trim(), header ? { bold: true } : {}) })],
  });
}

function parse(md) {
  const meta = {};
  const blocks = [];
  let table = null;
  const flushTable = () => { if (table) { blocks.push({ type: 'table', rows: table }); table = null; } };
  for (const raw of md.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const m = /^@(key|name|description|source)\s+(.*)$/.exec(line);
    if (m) { meta[m[1]] = m[2].trim(); continue; }
    if (line.startsWith('|')) {
      (table ||= []).push(line.split('|').slice(1, -1));
      continue;
    }
    flushTable();
    if (!line.trim()) continue;
    if (line.startsWith('# ')) blocks.push({ type: 'title', text: line.slice(2) });
    else if (line.startsWith('## ')) blocks.push({ type: 'h', text: line.slice(3) });
    else if (line.startsWith('- ')) blocks.push({ type: 'bullet', text: line.slice(2) });
    else if (line.startsWith('@sig')) blocks.push({ type: 'sig', text: line.slice(4).trim() });
    else if (line === '@pagebreak') blocks.push({ type: 'break' });
    else blocks.push({ type: 'p', text: line });
  }
  flushTable();
  return { meta, blocks };
}

function toDocx({ blocks }) {
  const children = [];
  for (const b of blocks) {
    if (b.type === 'title') children.push(para(b.text, { run: { bold: true, size: 28 }, p: { alignment: AlignmentType.CENTER, spacing: { after: 280 } } }));
    else if (b.type === 'h') children.push(para(b.text, { run: { bold: true }, p: { heading: HeadingLevel.HEADING_2, spacing: { before: 240, after: 120 }, keepNext: true } }));
    else if (b.type === 'bullet') children.push(para(b.text, { p: { bullet: { level: 0 }, spacing: { after: 80 } } }));
    else if (b.type === 'break') children.push(new Paragraph({ children: [new PageBreak()] }));
    else if (b.type === 'sig') {
      children.push(new Paragraph({ children: [], spacing: { before: 360 } }));
      children.push(para('______________________________________', { p: { spacing: { after: 0 }, keepNext: true } }));
      children.push(para(b.text, { p: { spacing: { after: 200 } } }));
    } else if (b.type === 'table') {
      const border = { style: BorderStyle.SINGLE, size: 4, color: '888888' };
      children.push(new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: border, bottom: border, left: border, right: border, insideHorizontal: border, insideVertical: border },
        rows: b.rows.map((r, i) => new TableRow({ children: r.map(c => cell(c, i === 0)), tableHeader: i === 0 })),
      }));
      children.push(new Paragraph({ children: [], spacing: { after: 160 } }));
    } else children.push(para(b.text));
  }
  return new Document({
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    sections: [{ properties: { page: { margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } }, children }],
  });
}

// ── Verification ────────────────────────────────────────────────────────────

function render(bytes, ctx) {
  const doc = new Docxtemplater(new PizZip(bytes), {
    paragraphLoop: true, linebreaks: true, delimiters: { start: '{{', end: '}}' },
    nullGetter: (part) => (part.module ? '' : BLANK),
  });
  doc.render(ctx);
  return doc.getZip().generate({ type: 'nodebuffer' });
}

function docText(bytes) {
  const xml = new PizZip(bytes).file('word/document.xml').asText();
  return xml.replace(/<w:tab\/>/g, '\t').replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

const FIXTURE = {
  client: { full_legal_name: 'Maria Elena Lopez', county: 'Wake', address: '12 Oak Lane\nRaleigh, NC 27601', dob: '1980-03-02' },
  marriage: { status: 'married', spouse_name: 'Jose Antonio Lopez' },
  children: { has_children: 'yes', list: [{ name: 'Ana Lopez', dob: '2015-06-01' }, { name: 'Luis Lopez', dob: '2018-09-12' }] },
  guardians: { needed: 'yes', list: [{ name: 'Rosa Diaz', relationship: 'sibling', city_state: 'Cary, NC' }, { name: 'Pedro Diaz', relationship: 'sibling' }] },
  executors: { list: [{ name: 'Jose Antonio Lopez', relationship: 'spouse', city_state: 'Raleigh, NC' }, { name: 'Rosa Diaz', relationship: 'sibling', city_state: 'Cary, NC' }] },
  trust: { interest: 'yes', successor_trustees: [{ name: 'Rosa Diaz', relationship: 'sibling', city_state: 'Cary, NC' }] },
  distribution: { plan: 'spouse_then_children', young_beneficiary_age: '25', specific_gifts: [{ item: "Grandmother's ring", recipient: 'Ana Lopez' }] },
};

const allowed = contextKeys();
const built = [];
let failed = false;
const fail = (key, msg) => { failed = true; console.error(`✗ ${key}: ${msg}`); };

for (const file of fs.readdirSync(srcDir).filter(f => f.endsWith('.md')).sort()) {
  const { meta, blocks } = parse(fs.readFileSync(path.join(srcDir, file), 'utf8'));
  if (!meta.key || !meta.name) { fail(file, 'missing @key or @name'); continue; }
  const bytes = await Packer.toBuffer(toDocx({ blocks }));
  fs.writeFileSync(path.join(outDir, `${meta.key}.docx`), bytes);

  // Every tag must be in the contract.
  const xmlText = docText(bytes);
  const tags = [...xmlText.matchAll(/\{\{\s*([#^/]?)\s*([A-Za-z0-9_]+)\s*\}\}/g)].map(m => m[2]);
  const unknown = [...new Set(tags.filter(t => !allowed.has(t)))];
  if (unknown.length) fail(meta.key, `tags not in the merge contract: ${unknown.join(', ')}`);

  try {
    const filled = render(bytes, buildEstateContext({ answers: FIXTURE, now: new Date('2026-11-04T12:00:00Z') }));
    fs.writeFileSync(path.join(outDir, `${meta.key}.filled.docx`), filled);
    const text = docText(filled);
    if (text.includes('{{')) fail(meta.key, 'a {{tag}} survived rendering');
    for (const name of ['Maria Elena Lopez', 'MARIA ELENA LOPEZ']) {
      if (!text.includes(name)) fail(meta.key, `fixture name "${name}" missing from the render`);
    }
    if (meta.key === 'nc_revocable_trust' && !text.includes("Grandmother's ring")) fail(meta.key, 'Schedule B gift row did not render');
    if (meta.key === 'nc_pour_over_will' && !text.includes('Ana Lopez (born June 1, 2015) and Luis Lopez (born September 12, 2018)')) fail(meta.key, 'children did not render');
    render(bytes, buildEstateContext({ answers: {} }));   // and an empty questionnaire must not crash
  } catch (e) {
    fail(meta.key, `render error: ${e?.properties?.errors?.map(x => x.message).join('; ') || e.message}`);
  }

  built.push({
    key: meta.key, name: meta.name, description: meta.description || '', source: meta.source || '',
    statute: null, statutory: false, base64: Buffer.from(bytes).toString('base64'),
  });
  console.log(`✓ ${meta.key} (${bytes.length} bytes, ${new Set(tags).size} distinct tags)`);
}

if (failed) process.exit(1);

const banner = `// GENERATED by scripts/ep/build-plan-templates.mjs from scripts/ep/src/*.md — do not edit.
// NC will / trust templates (not statutory forms). Installed into draft_templates by
// /api/ep-intake/install-starters alongside _ep-starter-templates.js.
`;
fs.writeFileSync(path.join(root, 'functions/api/_ep-plan-templates.js'),
  `${banner}export const PLAN_TEMPLATES = ${JSON.stringify(built, null, 2)};\n`);
console.log(`wrote functions/api/_ep-plan-templates.js (${built.length} templates)`);
