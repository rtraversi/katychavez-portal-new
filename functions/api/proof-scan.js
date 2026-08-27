// proof-scan.js — queues a proof scan. Does no work.
// POST only. Body: { upload_id: string, filename: string } → 202 { scan_id }
//
// This endpoint used to be the whole feature: it took the package, called
// Claude, and held the connection open until a report came back. A 107-page AOS
// package returned HTTP 524 that way — the edge stopped waiting before one
// blocking call over that many pages finished (PROOF-SCAN-HANDOFF.md §6).
//
// So the scan is now a job. This creates the row and returns; the work happens
// in /api/proof-scan-process (fired by the browser straight after) or in the
// cron sweeper, for anything that request never reached. Nothing here can time
// out, because nothing here waits.
//
// The package never touches this request either: it was PUT to
// /api/proof-scan-upload, which staged it in R2 and returned the upload_id.

import { verifyAuth, json } from './_helpers.js';
import { isUploadId } from './proof-scan-upload.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'proof_scan');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { upload_id, filename } = body;
  if (!isUploadId(upload_id)) return json(400, { error: 'No file provided — upload the package first.' });

  const { admin } = auth;

  // DEMO_MODE: no job, no Claude — point the poller at the most recent stored
  // report so the page can be clicked through without an API key or storage.
  // Seeds one on a portal that has never scanned, so a fresh demo still works.
  if (env.DEMO_MODE === 'true') {
    const { data: rows } = await admin.from('proof_scans')
      .select('id')
      .in('status', ['pass', 'needs_correction'])
      .order('created_at', { ascending: false })
      .limit(1);
    if (rows?.[0]) return json(202, { scan_id: rows[0].id, demo: true });

    const { data: seeded } = await admin.from('proof_scans').insert({
      filename:    filename || 'document.pdf',
      status:      'pass',
      result_html: '<div class="proof-result pass"><h3>✓ Form Verified — No Issues Found</h3><p>All fields complete. Package is ready to file.</p></div>',
      scanned_by:  auth.profile.id,
    }).select('id');
    return json(202, { scan_id: seeded?.[0]?.id || null, demo: true });
  }

  const { data: rows, error } = await admin
    .from('proof_scans')
    .insert({
      filename:   filename || 'document.pdf',
      upload_id,
      status:     'queued',
      scanned_by: auth.profile.id,
    })
    .select('id');

  if (error) {
    console.error('[proof-scan] could not queue scan:', error.message);
    return json(500, { error: 'The scan could not be queued. Please try again.' });
  }

  return json(202, { scan_id: rows?.[0]?.id });
}
