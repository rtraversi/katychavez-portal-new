import { verifyAuth, makeAdminClient, json } from './_helpers.js';

// Manual time entry, logged from the billing screen in MINUTES ("they forgot
// to bill a call"). Stored in the portal's time_entries table; it surfaces in
// the unbilled list next to provider-pulled time (get-unbilled-time merges
// both), prices from the per-client rate resolver, and rounds up to the firm's
// billing increment at read time like every other entry.
export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'billing');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { matter_id, user_id, description, entry_date, no_charge } = body;
  const minutes = Number(body.minutes);

  if (!matter_id)                          return json(400, { error: 'matter_id required' });
  if (!user_id)                            return json(400, { error: 'user_id required — pick who the time belongs to' });
  if (!description?.trim())                return json(400, { error: 'Description required' });
  if (!Number.isFinite(minutes) || minutes <= 0 || minutes > 24 * 60) {
    return json(400, { error: 'Minutes must be between 1 and 1440' });
  }

  // hours is DECIMAL(5,2): store the typed time at 2dp (1 min → 0.02h). The
  // billing increment rounds it up further at read time; what's stored stays
  // the closest representation of what was actually worked.
  const hours = Math.max(0.01, Math.round((minutes / 60) * 100) / 100);

  const admin = makeAdminClient(env);

  // The matter must exist — also anchors the entry to a client for rate lookup.
  const { data: matter } = await admin
    .from('matters').select('id').eq('id', matter_id).single();
  if (!matter) return json(404, { error: 'Matter not found' });

  const { data: entry, error } = await admin
    .from('time_entries')
    .insert({
      matter_id,
      user_id,
      entry_date:  entry_date || undefined,   // DB default = today
      hours,
      description: description.trim(),
      // rate null = resolve per-client at read; 0 = explicit no-charge entry.
      rate:        no_charge ? 0 : null,
      status:      'unbilled',
      created_by:  auth.profile.id,
    })
    .select()
    .single();

  if (error) return json(500, { error: error.message });

  return json(201, { time_entry: entry });
}
