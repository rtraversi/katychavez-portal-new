#!/usr/bin/env node
// One-time, manual, per-form template normalizer for the USCIS form filler.
//
// USCIS's official fillable PDFs are owner-password encrypted, which plain
// pdf-lib (the Worker runtime dependency) cannot decrypt — it silently reports
// 0 form fields. This script uses @cantoo/pdf-lib (devDependency only, never
// bundled into the Worker) to decrypt + strip the legacy XFA layer once per
// form, producing a clean AcroForm-only PDF that the Worker can fill at
// request time with plain pdf-lib.
//
// Usage:
//   node scripts/normalize-form-template.js i-821d           # normalize + inspect only
//   node scripts/normalize-form-template.js i-821d --upload  # also upload to R2
//
// Reads raw PDFs from C:\Sites\uscis\<form-key>.pdf, writes normalized output
// to ./normalized/<form-key>.pdf for manual inspection.

'use strict';

const fs   = require('fs');
const path = require('path');

// ── Load .env for local dev (same pattern as scripts/build-config.js) ────────
if (!process.env.R2_ACCOUNT_ID) {
  try {
    const envPath = path.join(__dirname, '..', '.env');
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const idx = trimmed.indexOf('=');
      if (idx === -1) continue;
      const key = trimmed.slice(0, idx).trim();
      const val = trimmed.slice(idx + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
  } catch (_) {
    console.warn('[normalize-form-template] No .env file found — relying on environment variables only');
  }
}

const RAW_DIR    = path.join(__dirname, '..', 'uscis-forms');
const OUTPUT_DIR = path.join(__dirname, '..', 'normalized');

async function main() {
  const args     = process.argv.slice(2);
  const formKey  = args.find(a => !a.startsWith('--'));
  const doUpload = args.includes('--upload');

  if (!formKey) {
    console.error('Usage: node scripts/normalize-form-template.js <form-key> [--upload]');
    process.exit(1);
  }

  const { PDFDocument } = require('@cantoo/pdf-lib');

  const rawPath = path.join(RAW_DIR, `${formKey}.pdf`);
  if (!fs.existsSync(rawPath)) {
    console.error(`[normalize-form-template] Source PDF not found: ${rawPath}`);
    process.exit(1);
  }

  console.log(`[normalize-form-template] Loading ${rawPath}...`);
  const rawBytes = fs.readFileSync(rawPath);
  // @cantoo/pdf-lib strips the legacy Adobe LiveCycle XFA layer automatically
  // during load (logs "Removing XFA form data..."), leaving the AcroForm
  // fields as the sole source of truth for viewers — no manual XFA handling needed.
  const pdfDoc = await PDFDocument.load(rawBytes, { ignoreEncryption: true, password: '' });

  const form = pdfDoc.getForm();

  // The PDF417 barcodes on USCIS forms were rendered at runtime by the XFA
  // layer we strip — the AcroForm layer holds only a text field whose value
  // is the barcode payload ("I-821D|01/20/25|7": form, edition, page). With
  // XFA gone, viewers show that raw text. The payload is static per page, so
  // render a real PDF417 once here, stamp it where the field sat, and remove
  // the text field.
  await stampBarcodes(pdfDoc, form);

  // USCIS authors many fields read-only (in the original XFA form they were
  // script-populated — e.g. G-28 Part 2's licensing authority / bar number /
  // firm name and the 1.c disciplinary checkboxes). With the XFA layer
  // stripped those locks are vestigial: they don't stop pdf-lib autofill at
  // generate time, but they DO stop attorneys hand-editing the template in
  // Acrobat (the template-defaults round-trip). Strip them all.
  let readOnlyCleared = 0;
  for (const f of form.getFields()) {
    if (f.isReadOnly()) { f.disableReadOnly(); readOnlyCleared++; }
  }
  if (readOnlyCleared) console.log(`[normalize-form-template] Cleared read-only flag on ${readOnlyCleared} fields`);

  const fields = form.getFields().map(f => ({
    name: f.getName(),
    type: f.constructor.name.replace('PDF', ''),
  }));

  const byType = {};
  fields.forEach(f => { byType[f.type] = (byType[f.type] || 0) + 1; });
  console.log(`[normalize-form-template] ${fields.length} fields found:`, byType);

  // No values are set during normalization, so no appearance regeneration is
  // wanted — this also guarantees the barcode appearance streams survive.
  const outBytes = await pdfDoc.save({ updateFieldAppearances: false });

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const outPath = path.join(OUTPUT_DIR, `${formKey}.pdf`);
  fs.writeFileSync(outPath, outBytes);
  console.log(`[normalize-form-template] Wrote ${outPath} (${outBytes.length} bytes). Open it to confirm it's fillable with no password prompt.`);

  // Also dump the field inventory alongside, useful when hand-authoring the field map.
  const fieldsPath = path.join(OUTPUT_DIR, `${formKey}.fields.json`);
  fs.writeFileSync(fieldsPath, JSON.stringify(fields, null, 2));
  console.log(`[normalize-form-template] Wrote field inventory to ${fieldsPath}`);

  if (doUpload) {
    await uploadToR2(formKey, outBytes);
  } else {
    console.log('[normalize-form-template] Skipped upload (pass --upload to push to R2 once you\'ve confirmed the PDF looks right).');
  }
}

// Replace each PDF417BarCode1 text field with a real, drawn PDF417 barcode
// encoding the field's payload value, at the exact widget rectangle.
async function stampBarcodes(pdfDoc, form) {
  const bwipjs = require('bwip-js');
  const barcodeFields = form.getFields().filter(f => f.getName().includes('PDF417BarCode'));
  if (!barcodeFields.length) return;

  const pages = pdfDoc.getPages();
  let stamped = 0;

  for (const field of barcodeFields) {
    const payload = typeof field.getText === 'function' ? field.getText() : null;

    if (payload) {
      for (const widget of field.acroField.getWidgets()) {
        const rect = widget.getRectangle();
        // locate the page owning this widget annotation
        const page = pages.find(p => {
          const annots = p.node.Annots();
          if (!annots) return false;
          for (let i = 0; i < annots.size(); i++) {
            if (annots.lookup(i) === widget.dict) return true;
          }
          return false;
        });
        if (!page) { console.warn(`[normalize-form-template] No page found for barcode widget (${payload})`); continue; }

        const png = await bwipjs.toBuffer({
          bcid: 'pdf417',
          text: payload,
          scale: 4,
        });
        const img = await pdfDoc.embedPng(png);
        page.drawImage(img, { x: rect.x, y: rect.y, width: rect.width, height: rect.height });
        stamped++;
      }
    }

    form.removeField(field); // removes the text field + its widget annotations
  }

  console.log(`[normalize-form-template] Stamped ${stamped} PDF417 barcode(s), removed ${barcodeFields.length} barcode text field(s)`);
}

async function uploadToR2(formKey, bytes) {
  const required = ['R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error(`[normalize-form-template] Cannot upload — missing env vars: ${missing.join(', ')}`);
    process.exit(1);
  }

  const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');
  const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
    // Disable auto-checksum: AWS SDK v3 injects x-amz-checksum-crc32 headers
    // that cause R2 to reject the request before CORS/normal handling.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  const key = `form-templates/${formKey}.pdf`;
  await r2.send(new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: key,
    Body: bytes,
    ContentType: 'application/pdf',
  }));

  console.log(`[normalize-form-template] Uploaded to R2 at ${key}`);
  console.log(`[normalize-form-template] Now run: UPDATE public.form_templates SET r2_key = '${key}', field_count = <n> WHERE form_key = '${formKey}';`);
}

main().catch(err => {
  console.error('[normalize-form-template] Failed:', err);
  process.exit(1);
});
