// proof-scan-process.js — runs one queued scan.
// POST { scan_id }
//
// The browser fires this immediately after /api/proof-scan queues the job and
// then forgets about it; the poller drives the UI. This request stays open for
// the whole generation, which is what makes the scan start now rather than on
// the next cron tick — but nothing depends on it finishing. If the tab closes
// and takes this request with it, the row is still queued (or requeued after
// its claim goes stale) and runProofScanSweep picks it up.
//
// Claim protocol: queued → processing → pass | needs_correction | error, as a
// conditional UPDATE. A double-fired request finds zero rows and backs off, so
// the same package is never scanned twice — and never billed twice.

import { verifyAuth, json } from './_helpers.js';
import { claimScan, runProofScan } from './_proof-scan-run.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'proof_scan');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { scan_id } = body;
  if (!scan_id) return json(400, { error: 'scan_id is required' });

  const { admin } = auth;

  const claimed = await claimScan(admin, scan_id);
  if (!claimed) {
    // Not ours to run. Either it does not exist, or the sweeper (or a duplicate
    // of this request) already has it — report where it got to and stop.
    const { data: rows } = await admin
      .from('proof_scans').select('status').eq('id', scan_id).limit(1);
    const status = rows?.[0]?.status;
    if (!status) return json(404, { error: 'Scan not found' });
    return json(200, { ok: true, status });
  }

  await admin.from('proof_scans')
    .update({ attempts: (claimed.attempts ?? 0) + 1 })
    .eq('id', claimed.id);

  const result = await runProofScan(env, admin, claimed);

  // 200 either way: the poller reads the row, not this response. A non-2xx here
  // would only tell the browser something it is about to learn anyway.
  return json(200, { ok: result.status !== 'error', status: result.status });
}
