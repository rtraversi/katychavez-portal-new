// GET  /api/calendar/ical-token  — return the current user's iCal feed token
// POST /api/calendar/ical-token  — regenerate the token (invalidates old feed URL)

import { verifyAuth, json, makeAdminClient } from './_helpers.js';

export async function onRequest({ request, env }) {
  const auth = await verifyAuth(request, env, 'read', 'calendar');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const supabase = makeAdminClient(env);

  if (request.method === 'GET') {
    const { data } = await supabase
      .from('users')
      .select('ical_token')
      .eq('auth_id', auth.user.id)
      .single();
    return json(200, { token: data?.ical_token || null });
  }

  if (request.method === 'POST') {
    const newToken = crypto.randomUUID();
    const { error } = await supabase
      .from('users')
      .update({ ical_token: newToken })
      .eq('auth_id', auth.user.id);
    if (error) return json(500, { error: 'Failed to regenerate token.' });
    return json(200, { token: newToken });
  }

  return json(405, { error: 'Method not allowed' });
}
