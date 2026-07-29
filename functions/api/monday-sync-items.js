// GET  /api/monday-sync-items       — the review queue and departure flags
// POST /api/monday-sync-items       — resolve one item: { id, action }
//
// GET requires read on monday_sync (attorneys and paralegals can look); POST requires
// admin, since dismissing a review item is a decision about the client list.
//
// Actions:
//   ignore   this is not a client, or staff have decided not to import it. Sticks —
//            buildPreview honours it on every later run so the same handful of working
//            notes stop asking for attention.
//   unignore put it back in play.
//   dismiss  acknowledge a departure flag. Nothing is archived; this only clears the
//            badge, per the 2026-07-20 decision that a client leaving the board group
//            must not touch their matters, documents or forms.

import { verifyAuth, json } from './_helpers.js';

const ACTIONS = ['ignore', 'unignore', 'dismiss'];

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method === 'GET') {
    const auth = await verifyAuth(request, env, 'read', 'monday_sync');
    if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

    const [{ data: items, error }, { data: state }] = await Promise.all([
      auth.admin
        .from('monday_sync_items')
        .select('id, monday_item_id, item_name, status, reason, parsed, client_id, resolved_at')
        .in('status', ['review', 'ignored', 'departed'])
        .order('status', { ascending: true })
        .order('item_name', { ascending: true }),
      auth.admin.from('monday_sync_state').select('*').maybeSingle(),
    ]);

    if (error) return json(500, { error: error.message });

    return json(200, {
      state: state || null,
      review: (items || []).filter((i) => i.status === 'review'),
      ignored: (items || []).filter((i) => i.status === 'ignored'),
      departed: (items || []).filter((i) => i.status === 'departed'),
    });
  }

  if (request.method === 'POST') {
    const auth = await verifyAuth(request, env, 'admin', 'monday_sync');
    if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

    let body;
    try { body = await request.json(); }
    catch { return json(400, { error: 'Invalid JSON' }); }

    const { id, action } = body || {};
    if (!id || !ACTIONS.includes(action)) {
      return json(400, { error: `id and action (${ACTIONS.join('|')}) are required` });
    }

    const { data: row, error: readErr } = await auth.admin
      .from('monday_sync_items').select('id, status').eq('id', id).maybeSingle();
    if (readErr) return json(500, { error: readErr.message });
    if (!row) return json(404, { error: 'Item not found' });

    if (action === 'dismiss' && row.status !== 'departed') {
      return json(409, { error: 'Only a departure flag can be dismissed' });
    }

    const patch =
      action === 'ignore'
        ? { status: 'ignored', resolved_by: auth.profile.id, resolved_at: new Date().toISOString() }
        : action === 'unignore'
          ? { status: 'review', resolved_by: null, resolved_at: null }
          // A dismissed departure becomes 'ignored' rather than being deleted — the
          // record that this client was once on the board is worth keeping.
          : { status: 'ignored', resolved_by: auth.profile.id, resolved_at: new Date().toISOString() };

    const { error } = await auth.admin.from('monday_sync_items').update(patch).eq('id', id);
    if (error) return json(500, { error: error.message });

    return json(200, { ok: true, id, status: patch.status });
  }

  return json(405, { error: 'Method not allowed' });
}
