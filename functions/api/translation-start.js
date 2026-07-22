// translation-start.js — accepts a translation job.
// POST { file_base64, filename, translator_name, translation_id, include_certification }
// Returns 202 immediately. The file is stashed in R2 (translation-tmp/) and the
// heavy Claude work happens in /api/translation-process, which the page calls
// next and which holds its request open for as long as the translation takes.
// (The old ctx.waitUntil() approach silently died on multi-page documents —
// the background window is too short for several minutes of generation, and
// the row stayed 'pending' forever.)

import { verifyAuth, json } from './_helpers.js';

export const TMP_PREFIX = 'translation-tmp/';
export const tmpKey = (id) => `${TMP_PREFIX}${id}`;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Daily cron: remove stashed uploads that never got processed (tab closed
// between start and process). Processed jobs delete their own temp object.
export async function runTranslationTmpCleanup(env) {
  if (!env.R2) return;
  const cutoff = Date.now() - 24 * 3600 * 1000;
  let cursor;
  do {
    const page = await env.R2.list({ prefix: TMP_PREFIX, cursor });
    const stale = page.objects
      .filter(o => new Date(o.uploaded).getTime() < cutoff)
      .map(o => o.key);
    if (stale.length) await env.R2.delete(stale);
    cursor = page.truncated ? page.cursor : undefined;
  } while (cursor);
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'translation');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { file_base64, filename, translator_name = '_________________________', translation_id, include_certification = true } = body;
  if (!file_base64 || !translation_id)
    return json(400, { error: 'file_base64 and translation_id are required' });
  // The id becomes part of an R2 key — accept only a real UUID.
  if (!UUID_RE.test(translation_id))
    return json(400, { error: 'translation_id must be a UUID' });

  // Insert pending row so the poll endpoint has something to find immediately
  try {
    await auth.admin.from('translations').insert({
      id:              translation_id,
      filename:        filename || 'document.pdf',
      translator_name,
      include_certification: include_certification !== false,
      status:          'pending',
    });
  } catch (err) {
    console.error('[translation] DB insert error:', err.message);
    return json(500, { error: 'Failed to create translation record' });
  }

  // DEMO_MODE: skip Claude entirely, immediately mark completed with canned translation
  if (env.DEMO_MODE === 'true') {
    const demoText = '{"format":"blocks-v1","source_language":"Spanish","blocks":[{"type":"title","text":"BIRTH CERTIFICATE"},{"type":"subtitle","text":"UNITED MEXICAN STATES — STATE OF JALISCO"},{"type":"fields","rows":[[{"label":"FULL NAME","value":"DEMO APPLICANT RODRIGUEZ"},{"label":"DATE OF BIRTH","value":"January 1, 1990"}],[{"label":"PLACE OF BIRTH","value":"Guadalajara, Jalisco, Mexico"}]]},{"type":"note","text":"[Official seal: CIVIL REGISTRY — GUADALAJARA]"},{"type":"paragraph","text":"This is a demo translation. In production, the full document text is translated by Claude AI and formatted with proper block structure."}]}';
    await auth.admin.from('translations')
      .update({ translated_text: demoText, status: 'completed', extracted_people: [{ full_name: 'Demo Applicant Rodriguez', role: 'Subject' }] })
      .eq('id', translation_id);
    return json(202, { ok: true, translation_id });
  }

  // Stash the file for the process step. Base64 → bytes once, here; the
  // process endpoint reads raw bytes back from R2.
  if (!env.R2) return json(500, { error: 'Storage binding not configured' });
  try {
    const raw   = atob(file_base64);
    const bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    await env.R2.put(tmpKey(translation_id), bytes);
  } catch (err) {
    console.error('[translation] temp store error:', err.message);
    await auth.admin.from('translations').update({ status: 'error' }).eq('id', translation_id);
    return json(500, { error: 'Failed to store file for processing' });
  }

  return json(202, { ok: true, translation_id });
}
