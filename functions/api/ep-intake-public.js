// Public (no login) estate-planning questionnaire endpoints. The token in the link
// is the only capability; only its SHA-256 is stored.
//
//   GET  /api/ep-intake/public-load?t=<token>   status + definition + saved progress
//   POST /api/ep-intake/public-save             { t, answers, lang }  autosave
//   POST /api/ep-intake/public-submit           { t, answers, lang, turnstile_token }
//
// What a token-holder can see: the firm name, the client's FIRST name (for the
// greeting), the questionnaire, and the answers saved under that same token. Never
// the matter id, other requests, or anything staff wrote.

import { makeAdminClient, json, verifyTurnstile } from './_helpers.js';
import { hashToken, looksLikeToken, requestStatus, readJson } from './_ep-common.js';
import { getQuestionnaire, DEFAULT_QUESTIONNAIRE_KEY } from './_ep-questionnaire.js';
import { validateAnswers, publicDefinition } from './_ep-validate.js';
import { notifyEstateIntakeSubmitted } from './_notifications.js';

const SELECT = 'id, matter_id, questionnaire_key, questionnaire_version, language, expires_at, revoked_at, submitted_at, opened_at, draft_answers, sent_by';

async function findRequest(admin, token) {
  if (!looksLikeToken(token)) return null;
  const hash = await hashToken(token);
  const { data, error } = await admin.from('ep_intake_requests').select(SELECT).eq('token_hash', hash).maybeSingle();
  if (error) throw new Error(error.message);
  return data || null;
}

export async function onRequest(context) {
  const { request, env } = context;
  const path = new URL(request.url).pathname;
  try {
    if (path.endsWith('/public-load'))   return await load(request, env);
    if (path.endsWith('/public-save'))   return await save(request, env);
    if (path.endsWith('/public-submit')) return await submit(request, env, context);
    return json(404, { error: 'Not found' });
  } catch (err) {
    console.error('[ep-intake-public]', err?.message || err);
    return json(500, { error: 'Server error' });
  }
}

async function load(request, env) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });
  const params = new URL(request.url).searchParams;
  const token = params.get('t') || '';
  const firmName = env.PORTAL_FIRM_NAME || '';

  // Staff "Preview" opens the page with no token: the questionnaire itself is not
  // secret, so show it with saving and submitting switched off.
  if (!token && params.get('preview') === '1') {
    const def = getQuestionnaire(params.get('q') || DEFAULT_QUESTIONNAIRE_KEY);
    if (!def) return json(404, { status: 'invalid', firm_name: firmName });
    return json(200, { status: 'preview', firm_name: firmName, language: params.get('lang') === 'es' ? 'es' : 'en',
      definition: publicDefinition(def), answers: {} });
  }

  const admin = makeAdminClient(env);

  const row = await findRequest(admin, token);
  const status = requestStatus(row);
  if (status !== 'open') return json(200, { status, firm_name: firmName, language: row?.language || 'en' });

  const def = getQuestionnaire(row.questionnaire_key);
  if (!def) return json(200, { status: 'invalid', firm_name: firmName });

  let firstName = '';
  const { data: m } = await admin.from('matters').select('client:clients(first_name)').eq('id', row.matter_id).maybeSingle();
  firstName = m?.client?.first_name || '';

  if (!row.opened_at) {
    await admin.from('ep_intake_requests').update({ opened_at: new Date().toISOString() }).eq('id', row.id);
  }

  return json(200, {
    status,
    firm_name: firmName,
    first_name: firstName,
    language: row.language || 'en',
    expires_at: row.expires_at,
    definition: publicDefinition(def),
    answers: row.draft_answers || {},
  });
}

async function save(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const { body, error } = await readJson(request);
  if (error) return json(400, { error });

  const admin = makeAdminClient(env);
  const row = await findRequest(admin, body.t);
  const status = requestStatus(row);
  if (status !== 'open') return json(status === 'invalid' ? 404 : 410, { error: 'This link is no longer open.', status });

  const def = getQuestionnaire(row.questionnaire_key);
  const { answers } = validateAnswers(def, body.answers, 'draft');
  const lang = body.lang === 'es' ? 'es' : 'en';
  const now = new Date().toISOString();

  const { error: upErr } = await admin.from('ep_intake_requests')
    .update({ draft_answers: answers, draft_saved_at: now, language: lang })
    .eq('id', row.id)
    .is('submitted_at', null);
  if (upErr) { console.error('[ep-intake-public] save:', upErr.message); return json(500, { error: 'Could not save' }); }

  return json(200, { ok: true, saved_at: now });
}

async function submit(request, env, context) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });
  const { body, error } = await readJson(request);
  if (error) return json(400, { error });

  const ip = request.headers.get('CF-Connecting-IP') || '';
  if (!(await verifyTurnstile(env, body.turnstile_token, ip, 'ep-intake-submit'))) {
    return json(403, { error: 'Verification failed. Please try again.', code: 'turnstile' });
  }

  const admin = makeAdminClient(env);
  const row = await findRequest(admin, body.t);
  const status = requestStatus(row);
  if (status === 'submitted') return json(409, { error: 'This questionnaire has already been submitted.', status });
  if (status !== 'open') return json(status === 'invalid' ? 404 : 410, { error: 'This link is no longer open.', status });

  const def = getQuestionnaire(row.questionnaire_key);
  const lang = body.lang === 'es' ? 'es' : 'en';
  const { answers, errors } = validateAnswers(def, body.answers, 'submit', lang);
  if (errors.length) return json(422, { error: 'Some required answers are missing.', errors });

  // Keep the full draft too: if the attorney later wants to see what was typed in a
  // section the client then hid, it is still there.
  const draft = validateAnswers(def, body.answers, 'draft').answers;
  const now = new Date().toISOString();

  const { data: updated, error: upErr } = await admin.from('ep_intake_requests')
    .update({
      submitted_at: now,
      answers_submitted: answers,
      answers,
      draft_answers: draft,
      draft_saved_at: now,
      language: lang,
    })
    .eq('id', row.id)
    .is('submitted_at', null)          // single use, even against a double-click race
    .select('id');
  if (upErr) { console.error('[ep-intake-public] submit:', upErr.message); return json(500, { error: 'Could not submit' }); }
  if (!updated?.length) return json(409, { error: 'This questionnaire has already been submitted.', status: 'submitted' });

  const notify = notifyStaff(env, admin, row).catch(e => console.error('[ep-intake-public] notify:', e.message));
  if (context?.waitUntil) context.waitUntil(notify); else await notify;

  return json(200, { ok: true, firm_name: env.PORTAL_FIRM_NAME || '' });
}

// The assigned attorney and whoever sent the link — deduplicated, active users only.
async function notifyStaff(env, admin, row) {
  const { data: m } = await admin.from('matters')
    .select('assigned_attorney_id, client:clients(first_name, last_name)')
    .eq('id', row.matter_id).maybeSingle();
  const ids = [...new Set([m?.assigned_attorney_id, row.sent_by].filter(Boolean))];
  if (!ids.length) return;
  const { data: users } = await admin.from('users').select('email, active').in('id', ids);
  const clientName = [m?.client?.first_name, m?.client?.last_name].filter(Boolean).join(' ') || 'A client';
  const emails = [...new Set((users || []).filter(u => u.active && u.email).map(u => u.email))];
  for (const to of emails) await notifyEstateIntakeSubmitted(env, { toEmail: to, clientName });
}
