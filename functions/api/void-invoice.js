import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'billing');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { invoice_id } = body;
  if (!invoice_id) return json(400, { error: 'invoice_id required' });

  const admin = makeAdminClient(env);

  const { data: invoice } = await admin
    .from('invoices')
    .select('id, status, invoice_line_items(time_entry_id)')
    .eq('id', invoice_id)
    .single();

  if (!invoice)                return json(404, { error: 'Invoice not found' });
  if (invoice.status === 'void') return json(400, { error: 'Invoice is already void' });
  if (invoice.status === 'paid') return json(400, { error: 'Paid invoices cannot be voided' });

  // F3 (IOLTA): Block void if trust disbursements have already been posted against this invoice.
  // Disbursements move money out of IOLTA — voiding the invoice after the fact would
  // create an unreconcilable gap between the invoice record and the trust ledger.
  const { data: disburse } = await admin
    .from('trust_ledger_entries')
    .select('id')
    .eq('invoice_id', invoice_id)
    .eq('entry_type', 'disbursement')
    .limit(1)
    .single();
  if (disburse) {
    return json(400, {
      error: 'Cannot void: trust disbursements have already been posted against this invoice.',
    });
  }

  // Restore billed time entries to unbilled
  const timeEntryIds = (invoice.invoice_line_items || [])
    .filter(i => i.time_entry_id)
    .map(i => i.time_entry_id);

  if (timeEntryIds.length) {
    await admin
      .from('time_entries')
      .update({ status: 'unbilled' })
      .in('id', timeEntryIds);
  }

  // Release billed expenses the same way — create-invoice stamps them with
  // this invoice_id, so voiding must hand them back to the unbilled pool or
  // they're stranded (never billable again, invisible on the next invoice).
  await admin
    .from('expenses')
    .update({ billed: false, invoice_id: null })
    .eq('invoice_id', invoice_id);

  const { data: updated, error } = await admin
    .from('invoices')
    .update({ status: 'void' })
    .eq('id', invoice_id)
    .select()
    .single();

  if (error) return json(500, { error: error.message });

  return json(200, { invoice: updated });
}
