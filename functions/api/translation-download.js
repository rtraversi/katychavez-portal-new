// translation-download.js — re-generates .docx for a stored translation.
// GET /api/translation-download?id=<uuid>

import { Packer }            from 'docx';
import { verifyAuth, json, makeAdminClient } from './_helpers.js';
import { buildTranslationDocx } from '../utils/translation-docx.js';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'translation');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const url = new URL(request.url);
  const id  = url.searchParams.get('id');
  if (!id) return json(400, { error: 'id required' });

  const admin = makeAdminClient(env);

  try {
    const { data: rows } = await admin
      .from('translations')
      .select('translated_text, translator_name, filename, include_certification')
      .eq('id', id)
      .limit(1);

    const record = rows?.[0];
    if (!record?.translated_text) return json(404, { error: 'Translation not found' });

    const doc        = buildTranslationDocx(record.translated_text, record.translator_name, record.include_certification !== false);
    const docxBase64 = await Packer.toBase64String(doc);

    return json(200, { docx_base64: docxBase64, filename: record.filename });

  } catch (err) {
    console.error('[translation-download] error:', err.message);
    return json(500, { error: err.message });
  }
}
