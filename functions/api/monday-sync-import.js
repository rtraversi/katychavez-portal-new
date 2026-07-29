// POST /api/monday-sync-import
// Confirm step: creates clients (and their opening matter) for the board items the
// caller selected, and records links for confident matches.
// Requires admin on the monday_sync module.
//
// Body: { item_ids: ["123", "456"] }
//
// The caller sends the item ids they confirmed in the preview, and this re-derives the
// decision for each from the live board rather than trusting a client-supplied plan.
// Otherwise a stale or edited preview could create records the reviewer never saw.

import { verifyAuth, json } from './_helpers.js';
import { MondayAdapter } from './_adapters/monday.js';
import { buildPreview, clientRowFor, matterRowFor } from './_monday-sync.js';

export async function onRequest(context) {
  const { request, env } = context;

  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'admin', 'monday_sync');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  if (!MondayAdapter.isConfigured(env)) {
    return json(503, { error: 'monday.com is not configured.' });
  }

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const itemIds = Array.isArray(body?.item_ids) ? body.item_ids.map(String) : null;
  if (!itemIds || itemIds.length === 0) {
    return json(400, { error: 'item_ids is required and must be a non-empty array' });
  }

  try {
    const adapter = new MondayAdapter(env);

    const [items, { data: clients }, { data: knownRows }, { data: caseTypes }] = await Promise.all([
      adapter.fetchGroupItems(),
      auth.admin.from('clients').select('id, first_name, last_name, phone, email, monday_item_id'),
      auth.admin.from('monday_sync_items').select('monday_item_id, status, reason'),
      auth.admin.from('case_types').select('id, key'),
    ]);

    const known = new Map((knownRows || []).map((r) => [String(r.monday_item_id), r]));
    const preview = buildPreview(items, clients || [], { known });
    const caseTypeId = new Map((caseTypes || []).map((c) => [c.key, c.id]));

    const selected = new Set(itemIds);
    const toCreate = preview.create.filter((e) => selected.has(String(e.item.id)));
    const toLink = preview.link.filter((e) => selected.has(String(e.item.id)));

    // An id the caller selected that is no longer creatable — the board changed, or it
    // was in review all along. Report it rather than silently doing nothing.
    const actionable = new Set([...toCreate, ...toLink].map((e) => String(e.item.id)));
    const skipped = itemIds.filter((id) => !actionable.has(id));

    const created = [];
    const failed = [];

    for (const entry of toCreate) {
      try {
        const { data: client, error: cErr } = await auth.admin
          .from('clients').insert(clientRowFor(entry)).select('id').single();
        if (cErr) throw new Error(cErr.message);

        const { data: matter, error: mErr } = await auth.admin
          .from('matters')
          .insert(matterRowFor(entry, client.id, caseTypeId.get(entry.caseTypeKey)))
          .select('id').single();
        // A client without its matter is recoverable and visible; failing the whole run
        // over it would strand the clients already created above.
        if (mErr) console.error('[monday-sync-import] matter insert failed', mErr.message);

        await recordItem(auth, entry, {
          status: 'imported',
          client_id: client.id,
          matter_id: matter?.id || null,
          reason: 'Created from monday.com',
        });

        created.push({ item_id: String(entry.item.id), client_id: client.id, matter_id: matter?.id || null });
      } catch (err) {
        console.error('[monday-sync-import]', entry.item.name, err.message);
        failed.push({ item_id: String(entry.item.id), name: entry.item.name, error: err.message });
      }
    }

    const linked = [];
    for (const entry of toLink) {
      try {
        // Only the back-link is written. Decision 2026-07-20: never update an existing
        // portal client from monday — the board's data is sparse and staff have cleaned
        // the portal's.
        const { error } = await auth.admin
          .from('clients')
          .update({ monday_item_id: String(entry.item.id) })
          .eq('id', entry.client_id);
        if (error) throw new Error(error.message);

        await recordItem(auth, entry, {
          status: 'imported',
          client_id: entry.client_id,
          reason: entry.reason || 'Linked to existing client',
        });
        linked.push({ item_id: String(entry.item.id), client_id: entry.client_id });
      } catch (err) {
        console.error('[monday-sync-import] link', entry.item.name, err.message);
        failed.push({ item_id: String(entry.item.id), name: entry.item.name, error: err.message });
      }
    }

    // Persist the review queue and the ignore list so the next run starts from what a
    // human already decided.
    for (const entry of preview.review) {
      await recordItem(auth, entry, { status: 'review', reason: entry.reason });
    }
    for (const entry of preview.ignored) {
      await recordItem(auth, entry, { status: 'ignored', reason: entry.reason });
    }

    await auth.admin.from('monday_sync_state').upsert({
      board_id: adapter.boardId,
      group_id: adapter.groupId,
      last_run_at: new Date().toISOString(),
      last_run_by: auth.profile.id,
      last_run_created: created.length,
      last_run_skipped: preview.review.length + preview.ignored.length,
      last_error: failed.length ? `${failed.length} item(s) failed` : null,
    }, { onConflict: 'board_id,group_id' });

    return json(200, {
      created,
      linked,
      skipped,
      failed,
      counts: {
        created: created.length,
        linked: linked.length,
        skipped: skipped.length,
        failed: failed.length,
      },
    });
  } catch (err) {
    console.error('[monday-sync-import]', err.message);
    return json(500, { error: err.message });
  }
}

/** Upsert one monday_sync_items row, keyed on the board item id. */
async function recordItem(auth, entry, fields) {
  const row = {
    monday_item_id: String(entry.item.id),
    item_name: entry.item.name,
    parsed: entry.parsed || null,
    raw: entry.item,
    ...fields,
  };
  if (fields.status === 'imported' || fields.status === 'ignored') {
    row.resolved_by = auth.profile.id;
    row.resolved_at = new Date().toISOString();
  }
  const { error } = await auth.admin
    .from('monday_sync_items')
    .upsert(row, { onConflict: 'monday_item_id' });
  if (error) console.error('[monday-sync-import] recordItem', error.message);
}
