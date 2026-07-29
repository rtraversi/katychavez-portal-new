// GET /api/monday-sync-preview
// Dry run: reads the monday board and reports exactly what an import would do, without
// writing anything. Requires admin on the monday_sync module.
//
// Separate read-only endpoint rather than a flag on the import route, matching the
// storage-sync recon pattern — a preview that shares a code path with a write is a
// preview that can eventually write.

import { verifyAuth, json } from './_helpers.js';
import { MondayAdapter } from './_adapters/monday.js';
import { buildPreview } from './_monday-sync.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'admin', 'monday_sync');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  if (!MondayAdapter.isConfigured(env)) {
    return json(503, {
      error: 'monday.com is not configured. Set MONDAY_API_TOKEN, MONDAY_BOARD_ID and MONDAY_GROUP_ID.',
    });
  }

  try {
    const adapter = new MondayAdapter(env);

    const [items, { data: clients, error: clientsErr }, { data: knownRows }] = await Promise.all([
      adapter.fetchGroupItems(),
      // Every client, not just linked ones — the whole point of the first run is to
      // match board items against clients that carry no link yet.
      auth.admin.from('clients').select('id, first_name, last_name, phone, email, monday_item_id'),
      auth.admin.from('monday_sync_items').select('monday_item_id, status, reason'),
    ]);

    if (clientsErr) throw new Error(`Could not read clients: ${clientsErr.message}`);

    const known = new Map((knownRows || []).map((r) => [String(r.monday_item_id), r]));
    const preview = buildPreview(items, clients || [], { known });

    return json(200, {
      board_id: adapter.boardId,
      group_id: adapter.groupId,
      ...preview,
    });
  } catch (err) {
    console.error('[monday-sync-preview]', err.message);
    return json(500, { error: err.message });
  }
}
