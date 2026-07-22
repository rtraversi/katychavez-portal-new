// CF Worker: /api/form-filler/matter-forms
//
//   POST   { matter_id, template_id }  — add a form to the matter
//   DELETE { matter_id, template_id }  — remove a form from the matter
//
// Migration 1605 made the case-type package a starting point rather than a
// rule: a real filing isn't always the same set of forms. An adjustment-of-
// status matter whose I-130 was already filed shouldn't be handed an I-130.
//
// Both verbs materialize the matter's list first (seedMatterForms) — this is
// the write half of materialize-on-write, so the matter stops tracking the
// shared package the moment someone adjusts it. Later edits to the case-type
// package then leave adjusted matters alone, which is the point.
//
// Removal is destructive by design: it deletes the form's generated drafts,
// their PDFs, and its manual field edits. A FINALIZED form cannot be removed —
// finalized means it's part of a real filing, so it must be un-finalized (or
// the whole package reset) deliberately first.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';
import { seedMatterForms } from './_fill-context.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[form-filler-matter-forms]', err);
    return json(500, { error: err?.message || 'Unexpected error' });
  }
}

async function handleRequest(request, env) {
  if (request.method !== 'POST' && request.method !== 'DELETE') {
    return json(405, { error: 'Method not allowed' });
  }

  const auth = await verifyAuth(request, env, 'write', 'draft_forms');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { matter_id, template_id } = body;
  if (!matter_id || !template_id) {
    return json(400, { error: 'matter_id and template_id are required' });
  }

  const admin  = makeAdminClient(env);
  const userId = auth.profile?.id || null;

  const { data: matter } = await admin
    .from('matters')
    .select('id, case_type_id')
    .eq('id', matter_id)
    .single();
  if (!matter) return json(404, { error: 'Matter not found' });

  // Materialize before mutating, so the matter owns its list from here on.
  const seedResult = await seedMatterForms(admin, matter, userId);
  if (seedResult.error) return json(seedResult.error.status, { error: seedResult.error.message });

  return request.method === 'POST'
    ? addForm(admin, env, matter, template_id, userId)
    : removeForm(admin, env, matter, template_id);
}

// ── Add ───────────────────────────────────────────────────────────────────────

async function addForm(admin, env, matter, template_id, userId) {
  const { data: tmpl } = await admin
    .from('form_templates')
    .select('id, form_key, label, r2_key, active')
    .eq('id', template_id)
    .maybeSingle();
  if (!tmpl)         return json(404, { error: 'Form template not found' });
  if (!tmpl.active)  return json(422, { error: 'That form is no longer available.' });
  if (!tmpl.r2_key)  return json(422, { error: 'That form template has not been uploaded yet.' });

  const { data: existing } = await admin
    .from('matter_forms')
    .select('id')
    .eq('matter_id', matter.id)
    .eq('template_id', template_id)
    .maybeSingle();
  if (existing) return json(409, { error: 'That form is already on this matter.' });

  // Append to the end of the current order.
  const { data: last } = await admin
    .from('matter_forms')
    .select('sort_order')
    .eq('matter_id', matter.id)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await admin.from('matter_forms').insert({
    matter_id:   matter.id,
    template_id,
    sort_order:  (last?.sort_order || 0) + 10,
    required:    false,   // manually added forms aren't required by the package
    source:      'manual',
    added_by:    userId,
  });
  if (error) return json(500, { error: 'Failed to add the form.' });

  return json(200, { ok: true, added: { template_id, form_key: tmpl.form_key, label: tmpl.label } });
}

// ── Remove ────────────────────────────────────────────────────────────────────

async function removeForm(admin, env, matter, template_id) {
  const { data: row } = await admin
    .from('matter_forms')
    .select('id')
    .eq('matter_id', matter.id)
    .eq('template_id', template_id)
    .maybeSingle();
  if (!row) return json(404, { error: 'That form is not on this matter.' });

  const { data: generated, error: genErr } = await admin
    .from('generated_forms')
    .select('id, status, r2_key, finalized_r2_key')
    .eq('matter_id', matter.id)
    .eq('template_id', template_id);
  if (genErr) return json(500, { error: 'Failed to check generated forms.' });

  // A finalized form is part of a real filing — refuse rather than destroy it.
  if ((generated || []).some(g => g.status === 'finalized')) {
    return json(409, {
      error: 'This form has been finalized and is part of the filing. Reset the form first if you really need to remove it.',
      finalized: true,
    });
  }

  // Delete PDFs before rows, so a partial failure never leaves rows pointing
  // at files that are already gone (same ordering as form-filler-reset.js).
  const keys = (generated || []).flatMap(g => [g.r2_key, g.finalized_r2_key]).filter(Boolean);
  if (keys.length) await env.R2.delete(keys);

  if (generated && generated.length) {
    const { error: delGenErr } = await admin
      .from('generated_forms')
      .delete()
      .eq('matter_id', matter.id)
      .eq('template_id', template_id);
    if (delGenErr) return json(500, { error: 'Failed to delete generated form records.' });
  }

  await admin.from('form_field_edits')
    .delete()
    .eq('matter_id', matter.id)
    .eq('template_id', template_id);

  const { error: delErr } = await admin.from('matter_forms').delete().eq('id', row.id);
  if (delErr) return json(500, { error: 'Failed to remove the form.' });

  return json(200, { ok: true, removed: template_id, deleted_versions: (generated || []).length });
}
