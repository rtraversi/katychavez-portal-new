// CF Worker: /api/form-filler/fields — backing API for the in-portal form
// editor (Prima-style editing + reverse autofill).
//
// GET  ?matter_id=&template_id=
//   Returns the template's mapped fields with, per field: the map descriptor,
//   what autofill currently resolves to, any per-matter manual edit, and
//   whether the field is eligible for reverse autofill (write-back).
//
// POST { matter_id, template_id, edits: [ { field_name, value, write_back? } ] }
//   value: string   -> upsert a manual edit (checkboxes 'Yes'/'No'; '' blanks)
//   value: null     -> revert to autofill (delete the manual edit row)
//   write_back:true -> instead of storing an edit, write the value THROUGH to
//                      the field's autofill source column (client card /
//                      immigration record / petitioner), so every other form
//                      picks it up; any stored edit for the field is removed.
//
// Reverse-autofill targets are derived from the template's own field_map —
// never from client input — so only mapped columns can ever be written.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';
import { resolvePath, applyTransform } from './_form-fill.js';
import { loadPackageTemplates, buildFillContext, loadManualEdits } from './_fill-context.js';

// Buckets reverse autofill may write to, and how to address their rows.
const WRITEBACK_BUCKETS = new Set(['client', 'immigration', 'petitioner', 'joint_sponsor']);

export async function onRequest(context) {
  const { request, env } = context;
  try {
    if (request.method === 'GET')  return await handleGet(request, env);
    if (request.method === 'POST') return await handlePost(request, env);
    return json(405, { error: 'Method not allowed' });
  } catch (err) {
    console.error('[form-filler-fields]', err);
    return json(500, { error: err?.message || 'Unexpected error' });
  }
}

// Whether a map descriptor is data-driven (reverse-autofillable), and its
// write-back target if so. ssn_full is deliberately excluded (encrypted;
// edited via the dedicated SSN flow only). family.<n> rows are v1-excluded.
function writebackTarget(descriptor) {
  const source = descriptor?.source || '';
  if (source === 'blank' || source.startsWith('literal:')) return null;
  const dotIdx = source.indexOf('.');
  if (dotIdx === -1) return null;
  const prefix = source.slice(0, dotIdx);
  const rest   = source.slice(dotIdx + 1);
  if (!WRITEBACK_BUCKETS.has(prefix)) return null;
  if (rest === 'ssn_full' || rest === 'full_name') return null;
  if (rest.includes('.')) return null; // family.<n>.<col> etc.
  return { bucket: prefix, column: rest };
}

async function resolveMatterTemplate(admin, matter_id, template_id) {
  const { data: matter } = await admin
    .from('matters')
    .select('id, client_id, case_type_id, assigned_attorney_id')
    .eq('id', matter_id)
    .single();
  if (!matter) return { error: { status: 404, message: 'Matter not found' } };

  const pkgResult = await loadPackageTemplates(admin, matter);
  if (pkgResult.error) return { error: pkgResult.error };

  const template = pkgResult.activeTemplates.find(t => t.id === template_id);
  if (!template) return { error: { status: 404, message: 'That form is not on this matter.' } };

  return { matter, pkg: pkgResult.pkg, activeTemplates: pkgResult.activeTemplates, template };
}

async function handleGet(request, env) {
  const auth = await verifyAuth(request, env, 'read', 'draft_forms');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const url = new URL(request.url);
  const matter_id   = url.searchParams.get('matter_id');
  const template_id = url.searchParams.get('template_id');
  if (!matter_id || !template_id) return json(400, { error: 'matter_id and template_id are required' });

  const admin = makeAdminClient(env);
  const resolved = await resolveMatterTemplate(admin, matter_id, template_id);
  if (resolved.error) return json(resolved.error.status, { error: resolved.error.message });
  const { matter, pkg, activeTemplates, template } = resolved;

  const [fillContext, editsByTemplate] = await Promise.all([
    buildFillContext(admin, matter, pkg, activeTemplates),
    loadManualEdits(admin, matter_id, template_id),
  ]);
  const manualEdits = editsByTemplate[template_id] || {};

  const effectiveMap = { ...(template.field_map || {}), ...(template.firm_overrides || {}) };
  const fields = Object.entries(effectiveMap).map(([name, descriptor]) => {
    let autofill = null;
    try {
      const r = resolvePath(descriptor.source, fillContext, env);
      if (!r.skip && r.value != null && r.value !== '') {
        autofill = String(descriptor.transform ? applyTransform(r.value, descriptor.transform) : r.value);
      }
    } catch { /* unreadable source — show as unfilled */ }

    const wb = writebackTarget(descriptor);
    return {
      name,
      type:           descriptor.type || 'text',
      source:         descriptor.source,
      transform:      descriptor.transform || null,
      autofill_value: autofill,
      manual_value:   Object.prototype.hasOwnProperty.call(manualEdits, name) ? manualEdits[name] : null,
      writeback:      wb, // { bucket, column } | null
    };
  });

  return json(200, {
    template: { id: template.id, form_key: template.form_key, label: template.label },
    fields,
  });
}

// Inverts a display transform back to storage format for write-back. Values
// come from a human typing into a form field, so be forgiving.
function invertTransform(value, transform) {
  const v = String(value).trim();
  if (v === '') return null;
  switch (transform) {
    case 'date_mmddyyyy':
    case 'date_slash': {
      const m = v.match(/^(\d{1,2})[\/\-]?(\d{1,2})[\/\-]?(\d{4})$/) || v.match(/^(\d{2})(\d{2})(\d{4})$/);
      if (m) return `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`;
      return v; // already ISO or unparseable — store as typed
    }
    case 'a_number': {
      const digits = v.replace(/\D/g, '');
      return digits ? `A${digits}` : null;
    }
    case 'yes_no':
      return v === 'Yes' || v === 'yes' || v === 'true';
    case 'yes_no_invert':
      return !(v === 'Yes' || v === 'yes' || v === 'true');
    default:
      return v;
  }
}

async function applyWriteback(admin, matter, target, value) {
  const { bucket, column } = target;

  if (bucket === 'client') {
    const { error } = await admin.from('clients').update({ [column]: value }).eq('id', matter.client_id);
    if (error) throw new Error(error.message);
    return;
  }

  if (bucket === 'immigration') {
    const { data: row } = await admin.from('client_immigration').select('id').eq('matter_id', matter.id).maybeSingle();
    if (row) {
      const { error } = await admin.from('client_immigration').update({ [column]: value }).eq('id', row.id);
      if (error) throw new Error(error.message);
    } else {
      const { error } = await admin.from('client_immigration').insert({ matter_id: matter.id, [column]: value });
      if (error) throw new Error(error.message);
    }
    return;
  }

  if (bucket === 'petitioner' || bucket === 'joint_sponsor') {
    const { data: rows } = await admin
      .from('opposing_parties').select('id, party_role')
      .eq('matter_id', matter.id)
      .order('created_at', { ascending: true });
    const row = bucket === 'joint_sponsor'
      ? (rows || []).find(r => r.party_role === 'joint_sponsor')
      : (rows || []).find(r => (r.party_role || 'primary') !== 'joint_sponsor');
    if (!row) {
      throw new Error(bucket === 'joint_sponsor'
        ? 'No joint sponsor recorded on this matter yet — add one on the Case tab first.'
        : 'No petitioner recorded on this matter yet — add one on the Case tab first.');
    }
    const { error } = await admin.from('opposing_parties').update({ [column]: value }).eq('id', row.id);
    if (error) throw new Error(error.message);
    return;
  }

  throw new Error(`Unsupported write-back bucket: ${bucket}`);
}

async function handlePost(request, env) {
  const auth = await verifyAuth(request, env, 'write', 'draft_forms');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { matter_id, template_id, edits } = body;
  if (!matter_id || !template_id) return json(400, { error: 'matter_id and template_id are required' });
  if (!Array.isArray(edits) || !edits.length) return json(400, { error: 'edits array is required' });
  if (edits.length > 500) return json(400, { error: 'Too many edits in one request.' });

  const admin = makeAdminClient(env);
  const resolved = await resolveMatterTemplate(admin, matter_id, template_id);
  if (resolved.error) return json(resolved.error.status, { error: resolved.error.message });
  const { matter, template } = resolved;

  const effectiveMap = { ...(template.field_map || {}), ...(template.firm_overrides || {}) };

  let saved = 0, reverted = 0, written_back = 0;
  const errors = [];

  for (const edit of edits) {
    const fieldName = edit?.field_name;
    if (!fieldName || typeof fieldName !== 'string') { errors.push('missing field_name'); continue; }
    try {
      if (edit.write_back) {
        const descriptor = effectiveMap[fieldName];
        const target = writebackTarget(descriptor);
        if (!target) throw new Error('Field is not eligible for reverse autofill.');
        const stored = invertTransform(edit.value ?? '', descriptor.transform);
        await applyWriteback(admin, matter, target, stored);
        // Autofill now supplies this value — a stored manual edit would shadow it.
        await admin.from('form_field_edits').delete()
          .eq('matter_id', matter_id).eq('template_id', template_id).eq('field_name', fieldName);
        written_back++;
      } else if (edit.value === null) {
        await admin.from('form_field_edits').delete()
          .eq('matter_id', matter_id).eq('template_id', template_id).eq('field_name', fieldName);
        reverted++;
      } else {
        const value = String(edit.value);
        if (value.length > 4000) throw new Error('Value too long.');
        const { error } = await admin.from('form_field_edits').upsert({
          matter_id, template_id, field_name: fieldName, value,
          updated_by: auth.profile?.id || null,
        }, { onConflict: 'matter_id,template_id,field_name' });
        if (error) throw new Error(error.message);
        saved++;
      }
    } catch (err) {
      errors.push(`${fieldName}: ${err.message}`);
    }
  }

  return json(errors.length && !saved && !reverted && !written_back ? 422 : 200,
    { saved, reverted, written_back, errors });
}
