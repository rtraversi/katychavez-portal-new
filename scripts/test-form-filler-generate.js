#!/usr/bin/env node
// Standalone local test harness for the form-filler generate flow.
//
// Mirrors functions/api/form-filler-generate.js + _form-fill.js's resolver
// logic without needing a running Worker (no wrangler dev required) — useful
// for quickly verifying a form's hand-authored field_map against real
// Supabase data. This is test tooling only; the resolver logic below is a
// standalone copy kept in sync manually with functions/api/_form-fill.js, not
// imported from it (that file uses ESM import syntax incompatible with this
// repo's plain-CommonJS scripts/ directory).
//
// Usage: node scripts/test-form-filler-generate.js <matter_id> [form_key=g-28]

'use strict';

const fs   = require('fs');
const path = require('path');

if (!process.env.SUPABASE_URL) {
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
    console.warn('[test-form-filler-generate] No .env file found — relying on environment variables only');
  }
}

// ── Resolver (standalone copy of functions/api/_form-fill.js, minus ssn_full
//    support since no field map needs it yet) ────────────────────────────────

const STATE_ABBREV = {
  texas: 'TX', california: 'CA', // extend if a test form needs more; full list lives in _form-fill.js
};

function applyTransform(value, transform) {
  if (value == null || value === '') return value;
  switch (transform) {
    case 'state_abbrev': {
      const v = String(value).trim();
      if (v.length === 2) return v.toUpperCase();
      return STATE_ABBREV[v.toLowerCase()] || v;
    }
    case 'yes_no':
      return value === true || value === 'true' || value === 'Yes' ? 'Yes' : 'No';
    default:
      return value;
  }
}

function resolvePath(source, context) {
  if (source === 'blank') return { skip: true };
  if (source.startsWith('literal:')) return { value: source.slice('literal:'.length) };

  const dotIdx = source.indexOf('.');
  if (dotIdx === -1) return { skip: true };
  const prefix = source.slice(0, dotIdx);
  const rest   = source.slice(dotIdx + 1);

  if (prefix === 'immigration' && rest.startsWith('family.')) {
    const parts  = rest.split('.');
    const member = context.familyMembers?.[Number(parts[1])];
    if (!member) return { skip: true };
    return { value: member[parts[2]] };
  }
  if (prefix === 'attorney' && rest === 'full_name') {
    const a = context.attorney;
    if (!a) return { skip: true };
    return { value: `${a.first_name || ''} ${a.last_name || ''}`.trim() || null };
  }
  const bucket = context[prefix];
  if (!bucket) return { skip: true };
  return { value: bucket[rest] };
}

function applyFieldMap(pdfForm, fieldMap, context) {
  let filledCount = 0, totalCount = 0;
  const warnings = [];
  for (const [fieldName, descriptor] of Object.entries(fieldMap || {})) {
    totalCount++;
    try {
      const resolved = resolvePath(descriptor.source, context);
      if (resolved.skip) continue;
      let value = resolved.value;
      if (value == null || value === '') continue;
      if (descriptor.transform) value = applyTransform(value, descriptor.transform);

      if (descriptor.type === 'text') {
        pdfForm.getTextField(fieldName).setText(String(value));
        filledCount++;
      } else if (descriptor.type === 'checkbox') {
        const truthy = value === true || value === 'true' || value === 'Yes' || value === 'yes';
        const cb = pdfForm.getCheckBox(fieldName);
        if (truthy) cb.check(); else cb.uncheck();
        filledCount++;
      } else if (descriptor.type === 'dropdown') {
        pdfForm.getDropdown(fieldName).select(String(value));
        filledCount++;
      } else {
        warnings.push(`${fieldName}: unknown type "${descriptor.type}"`);
      }
    } catch (err) {
      warnings.push(`${fieldName}: ${err.message}`);
    }
  }
  return { filledCount, totalCount, warnings };
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  const matterId = process.argv[2];
  const formKey  = process.argv[3] || 'g-28';
  if (!matterId) {
    console.error('Usage: node scripts/test-form-filler-generate.js <matter_id> [form_key]');
    process.exit(1);
  }

  const { createClient } = require('@supabase/supabase-js');
  const { PDFDocument }  = require('pdf-lib');
  const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');

  const required = ['SUPABASE_URL', 'SUPABASE_SERVICE_KEY', 'R2_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME'];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length) {
    console.error('[test-form-filler-generate] Missing env vars:', missing.join(', '));
    process.exit(1);
  }

  const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: matter, error: matterErr } = await admin
    .from('matters')
    .select('id, client_id, case_type_id, assigned_attorney_id')
    .eq('id', matterId)
    .single();
  if (matterErr || !matter) { console.error('[test-form-filler-generate] Matter not found:', matterErr?.message); process.exit(1); }

  const { data: tmpl, error: tmplErr } = await admin
    .from('form_templates')
    .select('id, form_key, label, r2_key, field_map')
    .eq('form_key', formKey)
    .single();
  if (tmplErr || !tmpl) { console.error('[test-form-filler-generate] Template not found:', tmplErr?.message); process.exit(1); }
  if (!tmpl.r2_key) { console.error('[test-form-filler-generate] Template has no r2_key set yet.'); process.exit(1); }

  const [{ data: client }, { data: immigration }, { data: familyMembers }, { data: firm }, { data: attorney }] = await Promise.all([
    admin.from('clients').select('*').eq('id', matter.client_id).single(),
    admin.from('client_immigration').select('*').eq('matter_id', matterId).maybeSingle(),
    admin.from('client_immigration_family_members').select('*').eq('matter_id', matterId).order('created_at', { ascending: true }),
    admin.from('firm_settings').select('*').limit(1).maybeSingle(),
    matter.assigned_attorney_id
      ? admin.from('users').select('id, first_name, last_name, email, phone, bar_number').eq('id', matter.assigned_attorney_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  console.log('[test-form-filler-generate] client:', client?.first_name, client?.last_name);
  console.log('[test-form-filler-generate] attorney:', attorney?.first_name, attorney?.last_name, 'bar#', attorney?.bar_number);
  console.log('[test-form-filler-generate] firm:', firm?.firm_name);

  const fillContext = {
    client:        client || {},
    matter,
    immigration:   immigration || {},
    familyMembers: familyMembers || [],
    firm:          firm || {},
    attorney:      attorney || {},
  };

  const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: process.env.R2_ACCESS_KEY_ID, secretAccessKey: process.env.R2_SECRET_ACCESS_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });

  const obj   = await r2.send(new GetObjectCommand({ Bucket: process.env.R2_BUCKET_NAME, Key: tmpl.r2_key }));
  const bytes = await obj.Body.transformToByteArray();

  const pdfDoc = await PDFDocument.load(bytes);
  const form   = pdfDoc.getForm();

  const { filledCount, totalCount, warnings } = applyFieldMap(form, tmpl.field_map, fillContext);
  console.log(`[test-form-filler-generate] Filled ${filledCount}/${totalCount} mapped fields.`);
  if (warnings.length) console.log('[test-form-filler-generate] Warnings:', warnings);

  const outBytes = await pdfDoc.save();
  const outDir = path.join(__dirname, '..', 'normalized');
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `${formKey}-test-fill.pdf`);
  fs.writeFileSync(outPath, outBytes);
  console.log(`[test-form-filler-generate] Wrote ${outPath} — open it to verify the fields.`);
}

main().catch(err => {
  console.error('[test-form-filler-generate] Failed:', err);
  process.exit(1);
});
