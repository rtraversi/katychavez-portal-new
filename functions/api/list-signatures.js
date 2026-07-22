// list-signatures.js — List staff members who have uploaded a signature, for the
// Signature Stamp picker. GET only. Requires sig_stamp access (only stamp-tool
// users need to choose whose signature to apply). Returns { signatures: [{ id, name }] }.

import { verifyAuth, json } from './_helpers.js';

const PREFIX = 'firm/signatures/';

export async function onRequest({ request, env }) {
  const auth = await verifyAuth(request, env, 'read', 'sig_stamp');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  // Signature objects are keyed firm/signatures/<users.id>.png.
  const listed = await env.R2.list({ prefix: PREFIX });
  const ids = (listed.objects || [])
    .map(o => o.key.slice(PREFIX.length).replace(/\.png$/, ''))
    .filter(Boolean);

  if (ids.length === 0) return json(200, { signatures: [] });

  const { data: users } = await auth.admin
    .from('users')
    .select('id, first_name, last_name')
    .in('id', ids);

  const signatures = (users || [])
    .map(u => ({
      id: u.id,
      name: [u.first_name, u.last_name].filter(Boolean).join(' ').trim() || 'Unnamed user',
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return json(200, { signatures });
}
