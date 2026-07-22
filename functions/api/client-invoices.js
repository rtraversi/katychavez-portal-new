import { verifyAuth, json } from './_helpers.js';

// Client-facing invoice list: a client sees the SENT and PAID invoices on
// their own matters — never drafts (pre-billing review is internal) and never
// voids. Read-only; the pay link and line items feed the client portal's
// Invoices card and its print/PDF view.
export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'core', { clientBypass: true });
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  if (!auth.isClient) return json(403, { error: 'Only client accounts can use this endpoint.' });

  const { admin } = auth;

  const { data: client } = await admin
    .from('clients')
    .select('id, first_name, last_name, email')
    .eq('auth_id', auth.user.id)
    .single();
  if (!client) return json(404, { error: 'No client record found for your account.' });

  const { data: matters } = await admin
    .from('matters')
    .select('id, case_number')
    .eq('client_id', client.id);
  const matterIds = (matters || []).map(m => m.id);
  if (!matterIds.length) return json(200, { invoices: [] });

  const { data: invoices, error } = await admin
    .from('invoices')
    .select(`
      id, invoice_number, description, amount, status, due_date, paid_at,
      created_at, payment_link,
      invoice_line_items(id, description, hours, rate, amount, item_type, sort_order),
      matters(id, case_number)
    `)
    .in('matter_id', matterIds)
    .in('status', ['sent', 'paid'])
    .order('created_at', { ascending: false });

  if (error) return json(500, { error: error.message });

  return json(200, {
    invoices: invoices || [],
    client: { first_name: client.first_name, last_name: client.last_name, email: client.email },
  });
}
