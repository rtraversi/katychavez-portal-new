// PUT /api/upload-proxy?doc={document_id}
// Receives the file body and writes it directly to R2 via S3 SDK.
// Routes uploads through the Worker (same-origin) instead of directly to R2,
// bypassing the CORS limitation on the R2 S3-compatible API endpoint.
// The document UUID acts as a capability token equivalent to a presigned URL.

import { makeAdminClient, json } from './_helpers.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[upload-proxy] Unhandled error:', err);
    return json(500, { error: `Unexpected error: ${err?.message || err}` });
  }
}

async function handleRequest(request, env) {
  if (request.method !== 'PUT') return json(405, { error: 'Method not allowed' });

  const url    = new URL(request.url);
  const docId  = url.searchParams.get('doc');
  if (!docId) return json(400, { error: 'Missing doc parameter' });

  const admin = makeAdminClient(env);
  const { data: doc, error } = await admin
    .from('documents')
    .select('id, r2_key, status, deleted_at, content_type')
    .eq('id', docId)
    .single();

  if (error || !doc)            return json(404, { error: 'Document not found' });
  if (doc.deleted_at)           return json(410, { error: 'Document has been deleted' });
  if (doc.status !== 'pending') return json(409, { error: 'Document is no longer pending' });

  const contentType = request.headers.get('content-type') || doc.content_type || 'application/octet-stream';

  if (!env.R2) {
    console.error('[upload-proxy] env.R2 binding is undefined — add [[r2_buckets]] binding = "R2" to wrangler.toml');
    return json(500, { error: 'Storage binding not configured' });
  }

  console.log('[upload-proxy] putting to R2, key:', doc.r2_key, 'contentType:', contentType);
  await env.R2.put(doc.r2_key, request.body, { httpMetadata: { contentType } });
  console.log('[upload-proxy] R2 put succeeded');

  return json(200, { ok: true });
}
