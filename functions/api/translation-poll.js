// translation-poll.js — polling endpoint for in-progress translations.
// GET /api/translation-poll?id=<uuid>

import { verifyAuth, json, makeAdminClient } from './_helpers.js';
import { translationText } from '../utils/translation-docx.js';

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
      .select('id, filename, status, translated_text, extracted_people, created_at')
      .eq('id', id)
      .limit(1);

    const translation = rows?.[0] ?? null;

    if (!translation) return json(200, { status: 'pending' });
    if (translation.status === 'pending') return json(200, { status: 'pending' });
    if (translation.status === 'error')   return json(200, { status: 'error' });

    const fullText = translationText(translation.translated_text);
    const preview  = fullText
      ? fullText.substring(0, 600) + (fullText.length > 600 ? '…' : '')
      : '';

    return json(200, {
      status:           'completed',
      translation_id:   translation.id,
      filename:         translation.filename,
      preview,
      extracted_people: translation.extracted_people || [],
    });

  } catch (err) {
    console.error('[translation-poll] error:', err.message);
    return json(500, { error: err.message });
  }
}
