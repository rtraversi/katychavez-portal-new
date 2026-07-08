// CF Worker: GET /api/form-filler/download?id=<generated_form_id>&final=1
// Streams a generated (or finalized) form PDF back from R2 so it opens
// directly in the browser's native fillable PDF viewer — no frontend PDF
// library needed. Pass final=1 once a form has been finalized to fetch the
// flattened copy instead of the fillable draft.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[form-filler-download]', err);
    return json(500, { error: err?.message || 'Unexpected error' });
  }
}

async function handleRequest(request, env) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'draft_forms');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const url    = new URL(request.url);
  const id     = url.searchParams.get('id');
  const wantsFinal = url.searchParams.get('final') === '1';
  if (!id) return json(400, { error: 'id is required' });

  const admin = makeAdminClient(env);
  const { data: row, error } = await admin
    .from('generated_forms')
    .select('r2_key, finalized_r2_key, file_name, status')
    .eq('id', id)
    .single();
  if (error || !row) return json(404, { error: 'Generated form not found' });

  const key = wantsFinal ? row.finalized_r2_key : row.r2_key;
  if (!key) return json(404, { error: wantsFinal ? 'This form has not been finalized yet.' : 'File not found.' });

  const obj = await env.R2.get(key);
  if (!obj) return json(404, { error: 'File missing in storage.' });

  return new Response(obj.body, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${row.file_name.replace(/"/g, '')}"`,
    },
  });
}
