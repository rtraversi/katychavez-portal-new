// Estate-planning drafting: fill Word templates from questionnaire answers.
//
//   GET  /api/ep-intake/templates?matter_id=   estate templates + starter catalog
//                                               + this matter's estate drafts
//   POST /api/ep-intake/install-starters        { reinstall? }  NC statutory starters → draft_templates + R2
//   POST /api/ep-intake/draft                   { matter_id, template_ids[], role, request_id? }
//
// Drafts land in the existing draft_documents / draft_document_versions tables under
// drafts/<matter>/<doc>/v1.docx, exactly like drafting-generate.js, so the card's
// Drafts list, versions, mark-final and open-in-Word (WebDAV) all work unchanged.
// The only difference is the merge context: _ep-merge-context.js instead of the
// case-data merge.

import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { makeAdminClient, json } from './_helpers.js';
import { generateWebDAVToken } from './webdav.js';
import { requireStaff, readJson, EP_CASE_TYPE_KEYS } from './_ep-common.js';
import { buildEstateContext, BLANK } from './_ep-merge-context.js';
import { STARTER_TEMPLATES } from './_ep-starter-templates.js';
import { PLAN_TEMPLATES } from './_ep-plan-templates.js';

// Statutory NC forms (POA, HCPOA, living will, HIPAA) + the NC will/trust
// templates. All install the same way; `statutory` tells the UI which is which.
const ALL_STARTERS = [...PLAN_TEMPLATES, ...STARTER_TEMPLATES];

const DOCX_MIME = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export async function onRequest({ request, env }) {
  const path = new URL(request.url).pathname;
  try {
    if (path.endsWith('/templates'))        return await listTemplates(request, env);
    if (path.endsWith('/install-starters')) return await installStarters(request, env);
    if (path.endsWith('/draft'))            return await draft(request, env);
    return json(404, { error: 'Not found' });
  } catch (err) {
    console.error('[ep-draft]', err?.message || err);
    return json(500, { error: err?.message || 'Server error' });
  }
}

async function listTemplates(request, env) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });
  const auth = await requireStaff(request, env, 'read');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  const matterId = new URL(request.url).searchParams.get('matter_id');

  const admin = makeAdminClient(env);
  const { data: templates } = await admin.from('draft_templates')
    .select('id, name, description, starter_key, template_docx_r2_key, sort_order, updated_at')
    .eq('merge_profile', 'estate_planning').eq('active', true)
    .order('sort_order').order('name');

  let drafts = [];
  if (matterId) {
    const { data } = await admin.from('draft_documents')
      .select('id, template_id, file_name, created_at, ep_role, is_final, current_version_num')
      .eq('matter_id', matterId).not('ep_role', 'is', null)
      .order('created_at', { ascending: false });
    drafts = data || [];
  }

  const installed = new Set((templates || []).map(t => t.starter_key).filter(Boolean));
  return json(200, {
    templates: (templates || []).map(t => ({ ...t, has_file: !!t.template_docx_r2_key })),
    starters: ALL_STARTERS.map(s => ({
      key: s.key, name: s.name, description: s.description, statute: s.statute,
      statutory: s.statutory, installed: installed.has(s.key),
    })),
    drafts,
  });
}

function b64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function installStarters(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const auth = await requireStaff(request, env, 'write');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  const { body, error } = await readJson(request);
  if (error) return json(400, { error });
  const reinstall = body.reinstall === true;

  const admin = makeAdminClient(env);
  const results = [];
  for (const [i, s] of ALL_STARTERS.entries()) {
    const { data: existing } = await admin.from('draft_templates')
      .select('id').eq('starter_key', s.key).maybeSingle();
    if (existing && !reinstall) { results.push({ key: s.key, status: 'already_installed' }); continue; }

    let id = existing?.id;
    if (!id) {
      const { data: ins, error: insErr } = await admin.from('draft_templates').insert({
        name: s.name,
        description: s.description,
        doc_category: 'other',
        case_types: EP_CASE_TYPE_KEYS,
        template_html: '',
        wizard_schema: [],
        sort_order: 100 + i,
        active: true,
        merge_profile: 'estate_planning',
        starter_key: s.key,
      }).select('id').single();
      if (insErr || !ins) { results.push({ key: s.key, status: 'error', error: insErr?.message }); continue; }
      id = ins.id;
    }

    const r2Key = `templates/${id}.docx`;
    await env.R2.put(r2Key, b64ToBytes(s.base64), { httpMetadata: { contentType: DOCX_MIME } });
    await admin.from('draft_templates')
      .update({ template_docx_r2_key: r2Key, active: true, merge_profile: 'estate_planning', updated_at: new Date().toISOString() })
      .eq('id', id);
    results.push({ key: s.key, status: existing ? 'reinstalled' : 'installed', id });
  }
  return json(200, { ok: true, results });
}

function renderDocx(bytes, ctx) {
  const zip = new PizZip(bytes);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
    // A tag the context doesn't know is a template typo: show the visible blank
    // rather than silently printing nothing. Sections/loops just don't render.
    nullGetter: (part) => (part.module ? '' : BLANK),
  });
  doc.render(ctx);
  return doc.getZip().generate({ type: 'arraybuffer' });
}

const safeFilePart = (s) => String(s || '').replace(/[\\/:*?"<>|#%]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);

async function draft(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const auth = await requireStaff(request, env, 'write');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const { body, error } = await readJson(request);
  if (error) return json(400, { error });
  const { matter_id } = body;
  const templateIds = Array.isArray(body.template_ids) ? body.template_ids.filter(Boolean).slice(0, 20) : [];
  const role = body.role === 'spouse' ? 'spouse' : 'client';
  if (!matter_id || !templateIds.length) return json(400, { error: 'matter_id and template_ids are required' });

  const admin = makeAdminClient(env);

  // The answers: a named request, or the latest submitted one for the matter.
  let q = admin.from('ep_intake_requests').select('id, answers, submitted_at')
    .eq('matter_id', matter_id).not('submitted_at', 'is', null);
  if (body.request_id) q = q.eq('id', body.request_id);
  const { data: reqs } = await q.order('submitted_at', { ascending: false }).limit(1);
  const req = reqs?.[0];
  if (!req) return json(409, { error: 'There is no submitted questionnaire for this matter yet.' });

  const married = ['married', 'separated'].includes(req.answers?.marriage?.status);
  if (role === 'spouse' && !(married && req.answers?.marriage?.spouse_name)) {
    return json(400, { error: 'The questionnaire has no spouse to draft for.' });
  }

  const { data: matter } = await admin.from('matters')
    .select('id, assigned_attorney_id, client:clients(first_name, middle_name, last_name, email, phone, cell_phone, dob, address_line1, address_line2, city, state, zip)')
    .eq('id', matter_id).maybeSingle();
  if (!matter) return json(404, { error: 'Matter not found' });

  let attorneyName = '';
  if (matter.assigned_attorney_id) {
    const { data: a } = await admin.from('users').select('first_name, last_name').eq('id', matter.assigned_attorney_id).maybeSingle();
    attorneyName = [a?.first_name, a?.last_name].filter(Boolean).join(' ');
  }

  const ctx = buildEstateContext({
    answers: req.answers || {}, client: matter.client || {}, role,
    firmName: env.PORTAL_FIRM_NAME || '', attorneyName,
  });

  const { data: templates } = await admin.from('draft_templates')
    .select('id, name, template_docx_r2_key')
    .in('id', templateIds).eq('merge_profile', 'estate_planning').eq('active', true);

  const initials = ((auth.profile?.first_name?.[0] || '') + (auth.profile?.last_name?.[0] || '')).toUpperCase() || 'XX';
  const today = new Date().toISOString().slice(0, 10);
  const who = ctx.principal_name !== BLANK ? ` - ${safeFilePart(ctx.principal_name)}` : '';
  const origin = new URL(request.url).origin;

  const created = [];
  const failed = [];
  for (const id of templateIds) {
    const tmpl = (templates || []).find(t => t.id === id);
    if (!tmpl) { failed.push({ template_id: id, error: 'Not an estate-planning template' }); continue; }
    if (!tmpl.template_docx_r2_key) { failed.push({ template_id: id, name: tmpl.name, error: 'No .docx uploaded for this template' }); continue; }

    const obj = await env.R2.get(tmpl.template_docx_r2_key);
    if (!obj) { failed.push({ template_id: id, name: tmpl.name, error: 'Template file missing from storage' }); continue; }

    let buf;
    try { buf = renderDocx(new Uint8Array(await obj.arrayBuffer()), ctx); }
    catch (e) {
      const msgs = e?.properties?.errors?.map(x => x.message).join('; ') || e.message;
      failed.push({ template_id: id, name: tmpl.name, error: `Template error: ${msgs}` });
      continue;
    }

    const fileName = `${today} ${initials} ${safeFilePart(tmpl.name)}${who}.docx`;
    const { data: doc, error: insErr } = await admin.from('draft_documents').insert({
      matter_id,
      template_id: id,
      generated_by: auth.profile?.id || null,
      wizard_data: { ep_request_id: req.id, role },
      file_name: fileName,
      current_version_num: 1,
      ep_role: role,
    }).select('id').single();
    if (insErr || !doc) { failed.push({ template_id: id, name: tmpl.name, error: 'Could not save the draft' }); continue; }

    const r2Key = `drafts/${matter_id}/${doc.id}/v1.docx`;
    await env.R2.put(r2Key, buf, { httpMetadata: { contentType: DOCX_MIME } });
    await admin.from('draft_document_versions').insert({
      document_id: doc.id, version_num: 1, r2_key: r2Key, size_bytes: buf.byteLength, created_by: auth.profile?.id || null,
    });

    const tok = await generateWebDAVToken(auth.profile.id, doc.id, env);
    const wordUrl = `ms-word:ofe|u|${origin}/webdav/${tok}/${doc.id}/${encodeURIComponent(fileName)}`;
    created.push({ doc_id: doc.id, file_name: fileName, word_url: wordUrl, template_id: id });
  }

  return json(created.length ? 200 : 422, { ok: created.length > 0, created, failed });
}
