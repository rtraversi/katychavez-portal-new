import { verifyAuth, makeAdminClient, json } from './_helpers.js';
import { isExternalEntryId, fetchConsumedExternalIds } from './_external-entry.js';
import { getTrustFirst, defaultAccountType } from './_firm-billing-settings.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'billing');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { matter_id, description, due_date, line_items } = body;
  if (!matter_id)          return json(400, { error: 'matter_id required' });
  if (!line_items?.length) return json(400, { error: 'At least one line item required' });

  const amount = line_items.reduce((sum, item) => sum + Number(item.amount), 0);
  if (amount <= 0) return json(400, { error: 'Invoice total must be greater than zero' });

  const admin = makeAdminClient(env);

  // invoice_line_items.time_entry_id is a uuid FK to the portal's time_entries.
  // Only portal-native entries belong there; entries pulled from an external
  // billing system (FreshBooks returns ids like "fb_344181434") aren't in that
  // table, so their id must NOT be written to the uuid column — doing so throws
  // "invalid input syntax for type uuid". Keep the FK null for those; the line
  // item still carries the description/hours/rate/amount.
  const isUuid = (v) =>
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  // Provider-pulled entries must not land on two live invoices. The unbilled
  // list already filters consumed ids (get-unbilled-time), but a stale screen
  // can still submit them — reject here so the guarantee is server-side.
  const externalIds = line_items.map(i => i.time_entry_id).filter(isExternalEntryId);
  if (externalIds.length) {
    const consumed = await fetchConsumedExternalIds(admin);
    const dupes = externalIds.filter(id => consumed.has(id));
    if (dupes.length) {
      return json(409, {
        error: `${dupes.length} selected time entr${dupes.length === 1 ? 'y is' : 'ies are'} already on another invoice. Refresh the unbilled list and try again.`,
      });
    }
  }

  const { data: invoice, error: invoiceErr } = await admin
    .from('invoices')
    .insert({
      matter_id,
      description: description || 'Legal Services',
      amount,
      due_date:   due_date || null,
      created_by: auth.profile.id,
      source:     'portal',
      status:     'draft',
      // Set explicitly rather than leaning on the invoices.account_type DB
      // default from 1526 — that default is 'trust' and would ignore a firm
      // with trust_first off. The DB default stays as a safety net.
      account_type: defaultAccountType(await getTrustFirst(admin)),
    })
    .select()
    .single();

  if (invoiceErr) return json(500, { error: invoiceErr.message });

  const items = line_items.map((item, i) => ({
    invoice_id:    invoice.id,
    time_entry_id: isUuid(item.time_entry_id) ? item.time_entry_id : null,
    // Provider entries keep their id here instead ("fb_…") so the pull layer
    // can exclude them from the unbilled list while this invoice is live
    // (migration 1533).
    external_entry_id: isExternalEntryId(item.time_entry_id) ? item.time_entry_id : null,
    // Expense lines point back at their expense row so draft editing can
    // un-bill the expense when the line is removed (migration 1532).
    expense_id:    isUuid(item.expense_id) ? item.expense_id : null,
    description:   item.description,
    hours:         item.hours || null,
    rate:          item.rate  || null,
    amount:        Number(item.amount),
    sort_order:    i,
    item_type:     item.item_type || 'time',
  }));

  const { error: itemsErr } = await admin.from('invoice_line_items').insert(items);
  if (itemsErr) {
    // Roll back the parent invoice so a line-item failure doesn't leave an
    // orphaned, empty draft behind.
    await admin.from('invoices').delete().eq('id', invoice.id);
    return json(500, { error: itemsErr.message });
  }

  // Mark linked time entries billed — only portal-native (uuid) ids. External
  // entries (e.g. FreshBooks) are tracked as billed in their own system.
  const timeEntryIds = line_items
    .map(i => i.time_entry_id)
    .filter(isUuid);

  if (timeEntryIds.length) {
    await admin
      .from('time_entries')
      .update({ status: 'billed' })
      .in('id', timeEntryIds);
  }

  // Mark billed expenses and link them to the invoice (matter + unbilled guards
  // stop a stale/foreign expense id from being claimed by this invoice)
  const expenseIds = body.expense_ids || [];
  if (expenseIds.length) {
    await admin
      .from('expenses')
      .update({ billed: true, invoice_id: invoice.id })
      .in('id', expenseIds)
      .eq('matter_id', matter_id)
      .eq('billed', false);
  }

  // Key MUST be invoice_line_items — that's what the billing UI reads when it
  // falls back to this raw insert response (get-invoices join uses the same key).
  return json(201, { invoice: { ...invoice, invoice_line_items: items } });
}
