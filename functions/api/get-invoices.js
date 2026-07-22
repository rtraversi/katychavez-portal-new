import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'billing');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const url = new URL(request.url);
  const matterId = url.searchParams.get('matter_id');
  const status   = url.searchParams.get('status');

  const admin = makeAdminClient(env);

  let query = admin
    .from('invoices')
    .select(`
      *,
      invoice_line_items(*),
      trust_ledger_entries(id, entry_type, created_at),
      matters(id, case_number, clients(id, first_name, last_name, email))
    `)
    .order('created_at', { ascending: false });

  if (matterId) query = query.eq('matter_id', matterId);
  if (status)   query = query.eq('status', status);

  const { data, error } = await query;
  if (error) return json(500, { error: error.message });

  return json(200, { invoices: data });
}
