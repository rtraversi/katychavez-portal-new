// GET /api/storage-sync-recon[?provider=dropbox]
// Phase 0 of the storage pull sync: read-only reconciliation report.
// Lists top-level client folders in the synced tree of one provider, parses
// "Last, First", and matches against the clients table (aliases count as
// matches). Nothing is written — this tells staff which clients must be
// seeded into the portal BEFORE the backfill runs.
//
// Defaults to the first configured provider; ?provider= selects another.
// Requires admin on the storage_sync module.

import { verifyAuth, json } from './_helpers.js';
import { configuredAdapters, adapterFor } from './_adapters/storage/index.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'admin', 'storage_sync');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const url = new URL(request.url);
  const requested = url.searchParams.get('provider');
  const adapter = requested
    ? adapterFor(env, requested)
    : configuredAdapters(env)[0];
  if (!adapter) {
    return json(503, { error: 'No storage provider is configured on this deployment.' });
  }
  const provider = adapter.constructor.provider;

  try {
    const folders = await adapter.listClientFolders(); // [{ name, folder_lower }]

    const [{ data: clients, error: cErr }, { data: aliases }] = await Promise.all([
      auth.admin.from('clients').select('id, first_name, last_name, active'),
      auth.admin.from('storage_sync_aliases')
        .select('folder_path_lower, client_id').eq('provider', provider),
    ]);
    if (cErr) return json(500, { error: cErr.message });

    const aliasByFolder = new Map((aliases || []).map((a) => [a.folder_path_lower, a.client_id]));
    const clientById = new Map(clients.map((c) => [c.id, c]));

    const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const byName = new Map();
    for (const c of clients) {
      const key = norm(`${c.last_name}, ${c.first_name}`);
      if (!byName.has(key)) byName.set(key, []);
      byName.get(key).push(c);
    }

    const label = (c) => `${c.last_name}, ${c.first_name}`;
    const matched = [];
    const ambiguous = [];
    const unmatched_folders = [];
    const matchedClientIds = new Set();

    for (const folder of folders) {
      const aliasClientId = aliasByFolder.get(folder.folder_lower);
      if (aliasClientId && clientById.has(aliasClientId)) {
        const c = clientById.get(aliasClientId);
        matched.push({ folder: folder.name, client_id: c.id, client_name: label(c), active: c.active, via: 'alias' });
        matchedClientIds.add(c.id);
        continue;
      }
      const candidates = byName.get(norm(folder.name)) || [];
      if (candidates.length === 1) {
        const c = candidates[0];
        matched.push({ folder: folder.name, client_id: c.id, client_name: label(c), active: c.active, via: 'name' });
        matchedClientIds.add(c.id);
      } else if (candidates.length > 1) {
        ambiguous.push({
          folder: folder.name,
          candidates: candidates.map((c) => ({ client_id: c.id, client_name: label(c) })),
        });
      } else {
        unmatched_folders.push({ folder: folder.name });
      }
    }

    const clients_without_folder = clients
      .filter((c) => !matchedClientIds.has(c.id))
      .map((c) => ({ client_id: c.id, client_name: label(c), active: c.active }));

    return json(200, {
      provider,
      folder_count:        folders.length,
      portal_client_count: clients.length,
      matched,
      ambiguous,
      unmatched_folders,
      clients_without_folder,
    });
  } catch (err) {
    console.error('[storage-sync-recon]', err.message);
    return json(500, { error: `Reconciliation failed: ${err.message}` });
  }
}
