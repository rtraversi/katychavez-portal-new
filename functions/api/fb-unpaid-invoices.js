// CF Pages Function: fb-unpaid-invoices
// GET — list FreshBooks invoices that aren't paid or draft yet (the biller
// finalizes in FreshBooks; this is the "From FreshBooks" picker's source list), each with
// a best-effort matter guess from the FB client's email.
// See FB-FIRST-INVOICE-PLAN.md.

import { verifyAuth, json } from './_helpers.js';
import { getBillingAdapter } from './_adapters/billing/index.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[fb-unpaid-invoices] Unhandled error:', err);
    return json(500, { error: 'An unexpected error occurred. Please try again.' });
  }
}

async function handleRequest(request, env) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'billing');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const { admin } = auth;

  const billingAdapter = getBillingAdapter(env);
  if (!billingAdapter?.listUnpaidInvoices) {
    return json(200, { invoices: [], source: null, connected: false });
  }

  let fbInvoices;
  try {
    fbInvoices = await billingAdapter.listUnpaidInvoices();
  } catch (err) {
    return json(502, { error: err.message });
  }

  // Drop FB invoices we've already mirrored into the portal. FreshBooks keeps a
  // sent-but-unpaid invoice in its "unpaid" list, so without this a completed
  // invoice keeps reappearing here even though it's already been mirrored and
  // sent. The mirror endpoint is idempotent (UNIQUE source+external_id), but the
  // panel is a to-do list — a done invoice shouldn't show up as still to-do.
  const extIds = [...new Set(fbInvoices.map(i => String(i.externalId)).filter(Boolean))];
  if (extIds.length) {
    const { data: mirrored } = await admin
      .from('invoices')
      .select('external_id')
      .eq('source', 'freshbooks')
      .in('external_id', extIds);
    const done = new Set((mirrored || []).map(r => String(r.external_id)));
    if (done.size) fbInvoices = fbInvoices.filter(i => !done.has(String(i.externalId)));
  }

  // Best-effort matter guess: FB client email → portal client → their active matters.
  const emails = [...new Set(
    fbInvoices.map(i => (i.clientEmail || '').toLowerCase().trim()).filter(Boolean)
  )];

  const mattersByEmail = new Map();
  if (emails.length) {
    const { data: clients } = await admin
      .from('clients')
      .select('email, matters(id, case_number, status)')
      .in('email', emails);
    for (const c of clients || []) {
      const active = (c.matters || []).filter(m => ['intake', 'active'].includes(m.status));
      mattersByEmail.set((c.email || '').toLowerCase().trim(), active);
    }
  }

  const invoices = fbInvoices.map(inv => {
    const matters = inv.clientEmail ? (mattersByEmail.get(inv.clientEmail.toLowerCase().trim()) || []) : [];
    return {
      ...inv,
      matter_guess:   matters.length === 1 ? { id: matters[0].id, case_number: matters[0].case_number } : null,
      matter_options: matters.length > 1 ? matters.map(m => ({ id: m.id, case_number: m.case_number })) : [],
    };
  });

  return json(200, { invoices, source: 'freshbooks', connected: true });
}
