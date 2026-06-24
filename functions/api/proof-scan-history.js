// proof-scan-history.js — Fetch last 10 proof scans for this firm.
// POST (uses auth header).

import { verifyAuth, json, makeAdminClient } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'proof_scan');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const admin = makeAdminClient(env);

  const { data: scans, error } = await admin
    .from('proof_scans')
    .select('id, filename, status, created_at')
    .order('created_at', { ascending: false })
    .limit(10);

  if (error) return json(500, { error: error.message });

  return json(200, { scans: scans || [] });
}
