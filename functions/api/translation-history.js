// translation-history.js — returns recent translation records.
// POST { limit?: number }

import { verifyAuth, json, makeAdminClient } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'translation');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let limit = 10;
  try {
    const b = await request.json();
    if (b?.limit) limit = parseInt(b.limit, 10);
  } catch { /* use default */ }

  const admin = makeAdminClient(env);

  try {
    const { data: translations } = await admin
      .from('translations')
      .select('id, filename, translator_name, status, created_at')
      .order('created_at', { ascending: false })
      .limit(limit);

    return json(200, { translations: translations || [] });

  } catch (err) {
    console.error('[translation-history] error:', err.message);
    return json(500, { error: err.message });
  }
}
