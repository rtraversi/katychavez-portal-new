// Shared helpers for client-intake-*.js functions. NOT a route endpoint.
// Resolves the calling client's own record and verifies they own the target
// matter and haven't already submitted (locked) intake for it.

export async function resolveOwnedMatter(admin, authUserId, matterId) {
  if (!matterId) return { error: { status: 400, message: 'matter_id is required.' } };

  const { data: client, error: clientErr } = await admin
    .from('clients')
    .select('id')
    .eq('auth_id', authUserId)
    .single();

  if (clientErr || !client) {
    return { error: { status: 404, message: 'No client record found for your account.' } };
  }

  const { data: matter, error: matterErr } = await admin
    .from('matters')
    .select('id, client_id, intake_submitted_at, is_dv_confidential')
    .eq('id', matterId)
    .single();

  if (matterErr || !matter) return { error: { status: 404, message: 'Matter not found.' } };
  if (matter.client_id !== client.id) return { error: { status: 403, message: 'Forbidden.' } };
  if (matter.intake_submitted_at) {
    return { error: { status: 409, message: 'Intake has already been submitted. Contact your attorney to make changes.' } };
  }

  return { clientId: client.id, matter };
}

// Picks only whitelisted keys present in body, trims strings, converts '' to null.
export function pickFields(body, allowed) {
  const out = {};
  for (const key of allowed) {
    if (!(key in body)) continue;
    const val = body[key];
    out[key] = typeof val === 'string' ? (val.trim() || null) : val;
  }
  return out;
}
