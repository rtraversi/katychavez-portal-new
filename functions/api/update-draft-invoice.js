import { verifyAuth, makeAdminClient, json } from './_helpers.js';
import { isExternalEntryId, fetchConsumedExternalIds } from './_external-entry.js';

// Draft-invoice editing for the pre-billing review flow ("Review Pending
// Invoices"): paralegals generate drafts, the billing attorney reviews and adjusts before
// anything is sent. Drafts only — sent/paid/void invoices are frozen.
//
// Body: {
//   invoice_id,
//   description?, due_date?,           // header edits
//   remove_line_item_ids?: [uuid],     // lines to drop (releases time/expenses)
//   add_items?: [{ time_entry_id?, expense_id?, description, hours?, rate?,
//                  amount, item_type }],
// }
//
// invoices.amount stays correct via the sync_invoice_amount trigger (1504),
// which recalculates the draft total on any line-item change.
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'billing');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { invoice_id, description, due_date } = body;
  const removeIds = body.remove_line_item_ids || [];
  const addItems  = body.add_items || [];
  if (!invoice_id) return json(400, { error: 'invoice_id required' });

  const isUuid = (v) =>
    typeof v === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

  const admin = makeAdminClient(env);

  const { data: invoice, error: fetchErr } = await admin
    .from('invoices')
    .select('id, status, matter_id, invoice_line_items(id, time_entry_id, expense_id, item_type, amount, sort_order)')
    .eq('id', invoice_id)
    .single();

  if (fetchErr || !invoice)       return json(404, { error: 'Invoice not found' });
  if (invoice.status !== 'draft') return json(400, { error: 'Only draft invoices can be edited' });

  const existing   = invoice.invoice_line_items || [];
  const byId       = new Map(existing.map(li => [li.id, li]));
  const toRemove   = removeIds.map(id => byId.get(id)).filter(Boolean);

  // Validate additions before touching anything.
  for (const item of addItems) {
    const amt = Number(item.amount);
    if (!item.description?.trim())          return json(400, { error: 'Every added line needs a description' });
    if (!Number.isFinite(amt) || amt < 0)   return json(400, { error: `Invalid amount for "${item.description}"` });
  }

  // The draft must still have at least one line and a positive total afterwards
  // — an emptied invoice should be voided, not edited into a husk.
  const removeSet = new Set(toRemove.map(li => li.id));
  const remaining = existing.filter(li => !removeSet.has(li.id));
  const newTotal  = remaining.reduce((s, li) => s + Number(li.amount), 0)
                  + addItems.reduce((s, it) => s + Number(it.amount), 0);
  if (remaining.length + addItems.length === 0) {
    return json(400, { error: 'This would remove every line item — void the invoice instead' });
  }
  if (newTotal <= 0) {
    return json(400, { error: 'Invoice total must stay greater than zero' });
  }

  const warnings = [];

  // ── Remove lines: release their time entries / expenses back to unbilled ──
  if (toRemove.length) {
    const { error: delErr } = await admin
      .from('invoice_line_items')
      .delete()
      .in('id', toRemove.map(li => li.id))
      .eq('invoice_id', invoice.id);
    if (delErr) return json(500, { error: delErr.message });

    const timeIds = toRemove.map(li => li.time_entry_id).filter(isUuid);
    if (timeIds.length) {
      await admin.from('time_entries').update({ status: 'unbilled' }).in('id', timeIds);
    }
    const expenseIds = toRemove.map(li => li.expense_id).filter(isUuid);
    if (expenseIds.length) {
      await admin.from('expenses')
        .update({ billed: false, invoice_id: null })
        .in('id', expenseIds);
    }
    // Legacy expense lines (pre-1532) carry no expense_id — the line is gone
    // but the expense row stays billed; flag it so it isn't silently lost.
    const orphaned = toRemove.filter(li => li.item_type === 'expense' && !li.expense_id).length;
    if (orphaned) {
      warnings.push(`${orphaned} removed expense line(s) predate expense linking — check the Expenses register and un-bill manually if needed.`);
    }
  }

  // ── Add lines ──────────────────────────────────────────────────────────────
  if (addItems.length) {
    // Same double-billing guard as create-invoice: a provider entry ("fb_…")
    // already on a live invoice — including a line of THIS draft — must not be
    // added again. Runs after removals so remove+re-add in one call still works.
    const externalIds = addItems.map(it => it.time_entry_id).filter(isExternalEntryId);
    if (externalIds.length) {
      const consumed = await fetchConsumedExternalIds(admin);
      const dupes = externalIds.filter((id, i) => consumed.has(id) || externalIds.indexOf(id) !== i);
      if (dupes.length) {
        return json(409, {
          error: `${dupes.length} added time entr${dupes.length === 1 ? 'y is' : 'ies are'} already on an invoice. Refresh the unbilled list and try again.`,
        });
      }
    }

    let sort = existing.reduce((m, li) => Math.max(m, li.sort_order || 0), -1) + 1;
    const rows = addItems.map(item => ({
      invoice_id:    invoice.id,
      time_entry_id: isUuid(item.time_entry_id) ? item.time_entry_id : null,
      external_entry_id: isExternalEntryId(item.time_entry_id) ? item.time_entry_id : null,
      expense_id:    isUuid(item.expense_id)    ? item.expense_id    : null,
      description:   item.description.trim(),
      hours:         item.hours || null,
      rate:          item.rate  || null,
      amount:        Number(item.amount),
      sort_order:    sort++,
      item_type:     item.item_type || 'time',
    }));

    const { error: insErr } = await admin.from('invoice_line_items').insert(rows);
    if (insErr) return json(500, { error: insErr.message });

    const timeIds = addItems.map(it => it.time_entry_id).filter(isUuid);
    if (timeIds.length) {
      await admin.from('time_entries').update({ status: 'billed' }).in('id', timeIds);
    }
    const expenseIds = addItems.map(it => it.expense_id).filter(isUuid);
    if (expenseIds.length) {
      await admin.from('expenses')
        .update({ billed: true, invoice_id: invoice.id })
        .in('id', expenseIds)
        .eq('matter_id', invoice.matter_id)
        .eq('billed', false);
    }
  }

  // ── Header edits ───────────────────────────────────────────────────────────
  const headerPatch = {};
  if (description !== undefined) headerPatch.description = description?.trim() || 'Legal Services';
  if (due_date    !== undefined) headerPatch.due_date    = due_date || null;
  if (Object.keys(headerPatch).length) {
    const { error: updErr } = await admin.from('invoices').update(headerPatch).eq('id', invoice.id);
    if (updErr) return json(500, { error: updErr.message });
  }

  // Return the fresh draft in the same joined shape the billing UI consumes.
  const { data: fresh, error: freshErr } = await admin
    .from('invoices')
    .select('*, invoice_line_items(*), matters(id, case_number, clients(id, first_name, last_name, email))')
    .eq('id', invoice.id)
    .single();
  if (freshErr) return json(500, { error: freshErr.message });

  return json(200, { invoice: fresh, warnings });
}
