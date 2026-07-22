// GET /api/intake-public-load?token=<uuid>
// Public endpoint (no bearer auth) — authorized solely by the matter's intake_token.
// Returns just enough context to render the public intake form: firm name, the
// client's first name (for a greeting), the case type (drives which sections show),
// and a status. Deliberately does NOT return the matter id or any stored answers —
// the token is the only capability, and this is a one-shot pre-portal form.

import { makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const token = new URL(request.url).searchParams.get('token');
  if (!token) return json(400, { error: 'Missing token' });

  const firmName = env.PORTAL_FIRM_NAME || 'the firm';
  const admin = makeAdminClient(env);

  let matter;
  try {
    const { data, error } = await admin
      .from('matters')
      .select('id, case_type, intake_submitted_at, intake_expires_at, client:clients(first_name)')
      .eq('intake_token', token)
      .maybeSingle();
    if (error) {
      console.error('[intake-public-load] query error:', error.message);
      return json(500, { error: 'Server error' });
    }
    matter = data;
  } catch (err) {
    console.error('[intake-public-load] fetch error:', err.message);
    return json(500, { error: 'Server error' });
  }

  if (!matter) return json(200, { status: 'invalid', firm_name: firmName });
  if (matter.intake_submitted_at) return json(200, { status: 'submitted', firm_name: firmName });
  if (matter.intake_expires_at && new Date(matter.intake_expires_at) < new Date()) {
    return json(200, { status: 'expired', firm_name: firmName });
  }

  return json(200, {
    status:            'open',
    firm_name:         firmName,
    client_first_name: matter.client?.first_name || '',
    case_type:         matter.case_type,
  });
}
