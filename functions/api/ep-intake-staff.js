// Staff side of the estate-planning questionnaire.
//
//   POST /api/ep-intake/send      { matter_id, language?, email?, send_email? }
//        Creates a fresh link (revoking any open one and carrying its saved
//        progress forward) and emails it. Returns the link ONCE so staff can also
//        text it — only the hash is stored, so it cannot be shown again later.
//   GET  /api/ep-intake/matter?matter_id=
//        Requests for the matter (no token hashes) + the questionnaire definitions
//        they use, for the client card's Estate Planning tab.
//   POST /api/ep-intake/answers   { request_id, answers }
//        Staff edits to submitted answers. answers_submitted is never touched.
//   POST /api/ep-intake/revoke    { request_id }

import { makeAdminClient, json } from './_helpers.js';
import {
  requireStaff, readJson, newToken, hashToken, requestStatus, portalUrl, EP_LINK_TTL_DAYS,
} from './_ep-common.js';
import { getQuestionnaire, DEFAULT_QUESTIONNAIRE_KEY } from './_ep-questionnaire.js';
import { validateAnswers, publicDefinition } from './_ep-validate.js';
import { notifyEstateIntakeRequest } from './_notifications.js';

const PUBLIC_COLS = 'id, matter_id, questionnaire_key, questionnaire_version, language, sent_to_email, sent_by, sent_at, emailed, expires_at, revoked_at, opened_at, draft_saved_at, submitted_at, answers, answers_submitted, draft_answers, answers_updated_at, answers_updated_by';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function onRequest({ request, env }) {
  const path = new URL(request.url).pathname;
  try {
    if (path.endsWith('/send'))    return await send(request, env);
    if (path.endsWith('/matter'))  return await matterView(request, env);
    if (path.endsWith('/answers')) return await saveAnswers(request, env);
    if (path.endsWith('/revoke'))  return await revoke(request, env);
    return json(404, { error: 'Not found' });
  } catch (err) {
    console.error('[ep-intake-staff]', err?.message || err);
    return json(500, { error: 'Server error' });
  }
}

async function send(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const auth = await requireStaff(request, env, 'write');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const { body, error } = await readJson(request);
  if (error) return json(400, { error });
  const { matter_id } = body;
  if (!matter_id) return json(400, { error: 'matter_id is required' });
  const language = body.language === 'es' ? 'es' : 'en';
  const sendEmail = body.send_email !== false;

  const admin = makeAdminClient(env);
  const { data: matter } = await admin.from('matters')
    .select('id, client:clients(first_name, last_name, email)')
    .eq('id', matter_id).maybeSingle();
  if (!matter) return json(404, { error: 'Matter not found' });

  const email = String(body.email || matter.client?.email || '').trim();
  if (sendEmail && !EMAIL_RE.test(email)) {
    return json(400, { error: 'No valid email address. Add one, or create the link without emailing it.' });
  }

  // Revoke the open request (if any) and carry its progress forward.
  const { data: open } = await admin.from('ep_intake_requests')
    .select('id, draft_answers, questionnaire_key')
    .eq('matter_id', matter_id).is('submitted_at', null).is('revoked_at', null)
    .maybeSingle();
  const now = new Date();
  if (open) {
    await admin.from('ep_intake_requests').update({ revoked_at: now.toISOString() }).eq('id', open.id);
  }

  const def = getQuestionnaire(open?.questionnaire_key) || getQuestionnaire(DEFAULT_QUESTIONNAIRE_KEY);
  const token = newToken();
  const expires = new Date(now.getTime() + EP_LINK_TTL_DAYS * 86400000);

  const { data: created, error: insErr } = await admin.from('ep_intake_requests').insert({
    matter_id,
    questionnaire_key: def.key,
    questionnaire_version: def.version,
    token_hash: await hashToken(token),
    language,
    sent_to_email: sendEmail ? email : null,
    sent_by: auth.profile?.id || null,
    sent_at: now.toISOString(),
    expires_at: expires.toISOString(),
    draft_answers: open?.draft_answers || {},
  }).select('id').single();
  if (insErr || !created) {
    console.error('[ep-intake-staff] insert:', insErr?.message);
    return json(500, { error: 'Could not create the questionnaire link.' });
  }

  const link = `${portalUrl(env, request)}/estate-intake?t=${token}`;
  let emailed = false;
  if (sendEmail) {
    try {
      await notifyEstateIntakeRequest(env, {
        toEmail: email, firstName: matter.client?.first_name || '', link, language, expiresDays: EP_LINK_TTL_DAYS,
      });
      emailed = !!env.RESEND_API_KEY;
      if (emailed) await admin.from('ep_intake_requests').update({ emailed: true }).eq('id', created.id);
    } catch (e) {
      console.error('[ep-intake-staff] email:', e.message);
    }
  }

  return json(200, {
    ok: true, request_id: created.id, link, emailed,
    expires_at: expires.toISOString(), carried_progress: !!(open && Object.keys(open.draft_answers || {}).length),
  });
}

async function matterView(request, env) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });
  const auth = await requireStaff(request, env, 'read');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const matterId = new URL(request.url).searchParams.get('matter_id');
  if (!matterId) return json(400, { error: 'matter_id is required' });

  const admin = makeAdminClient(env);
  const { data: rows, error } = await admin.from('ep_intake_requests')
    .select(PUBLIC_COLS).eq('matter_id', matterId).order('sent_at', { ascending: false });
  if (error) return json(500, { error: 'Could not load questionnaires' });

  const now = new Date();
  const requests = (rows || []).map(r => ({ ...r, status: requestStatus(r, now) }));
  const keys = new Set([DEFAULT_QUESTIONNAIRE_KEY, ...requests.map(r => r.questionnaire_key)]);
  const definitions = {};
  for (const k of keys) { const d = getQuestionnaire(k); if (d) definitions[k] = publicDefinition(d); }

  return json(200, {
    requests,
    definitions,
    default_key: DEFAULT_QUESTIONNAIRE_KEY,
    can_write: ['write', 'admin'].includes(auth.accessLevel),
  });
}

async function saveAnswers(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const auth = await requireStaff(request, env, 'write');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const { body, error } = await readJson(request);
  if (error) return json(400, { error });
  const admin = makeAdminClient(env);

  const { data: row } = await admin.from('ep_intake_requests')
    .select('id, questionnaire_key, submitted_at').eq('id', body.request_id).maybeSingle();
  if (!row) return json(404, { error: 'Questionnaire not found' });
  if (!row.submitted_at) return json(409, { error: 'Only a submitted questionnaire can be edited here.' });

  const def = getQuestionnaire(row.questionnaire_key);
  // Same rules as the client's submit (hidden sections dropped), but a missing
  // required answer is a warning for staff, not a refusal — the attorney knows.
  const { answers, errors } = validateAnswers(def, body.answers, 'submit');
  const now = new Date().toISOString();
  const { error: upErr } = await admin.from('ep_intake_requests')
    .update({ answers, answers_updated_at: now, answers_updated_by: auth.profile?.id || null })
    .eq('id', row.id);
  if (upErr) return json(500, { error: 'Could not save' });

  return json(200, { ok: true, answers, warnings: errors.map(e => e.message), updated_at: now });
}

async function revoke(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const auth = await requireStaff(request, env, 'write');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const { body, error } = await readJson(request);
  if (error) return json(400, { error });
  const admin = makeAdminClient(env);
  const { data, error: upErr } = await admin.from('ep_intake_requests')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', body.request_id).is('submitted_at', null).is('revoked_at', null)
    .select('id');
  if (upErr) return json(500, { error: 'Could not revoke' });
  if (!data?.length) return json(409, { error: 'That link is not open.' });
  return json(200, { ok: true });
}
