// proof-scan-poll.js — where has this scan got to?
// GET /api/proof-scan-poll?id=<uuid>
//
// The row is the only shared state between the browser, the process request and
// the cron sweeper, so this reads it and says one of four things: still waiting,
// running, done (with the report), or failed (with the reason). The result HTML
// is only sent once the scan is finished — a poll every 2.5s should not be
// re-fetching a report the page already has.

import { verifyAuth, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'proof_scan');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const id = new URL(request.url).searchParams.get('id');
  if (!id) return json(400, { error: 'id required' });

  const { data: rows, error } = await auth.admin
    .from('proof_scans')
    .select('id, filename, status, result_html, error_detail')
    .eq('id', id)
    .limit(1);

  if (error) return json(500, { error: error.message });

  const scan = rows?.[0];
  if (!scan) return json(404, { error: 'Scan not found' });

  if (scan.status === 'queued' || scan.status === 'processing') {
    return json(200, { status: scan.status });
  }

  if (scan.status === 'error') {
    return json(200, {
      status: 'error',
      error:  scan.error_detail || 'The scan did not complete.',
    });
  }

  return json(200, {
    status:   'completed',
    verdict:  scan.status,            // 'pass' | 'needs_correction'
    filename: scan.filename,
    html:     scan.result_html || '',
  });
}
