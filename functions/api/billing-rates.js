import { verifyAuth, makeAdminClient, json } from './_helpers.js';

// Billing-rates settings API.
//   GET                    -> { clients, staff }               (bootstrap the page)
//   GET  ?client_id=UUID   -> { clients, staff, rates, recurring_charge }
//   POST { client_id, rates:[{user_id,rate}], recurring_charge:{...} } -> upserts
//
// Reads need billing read; writes need billing write. Uses the service-role admin
// client (RLS is enforced separately via verifyAuth's module check).
export async function onRequest({ request, env }) {
  if (request.method === 'GET')  return handleGet(request, env);
  if (request.method === 'POST') return handlePost(request, env);
  return json(405, { error: 'Method not allowed' });
}

// Staff who can log billable time (everyone except the Client role).
async function loadStaff(admin) {
  const { data } = await admin
    .from('users')
    .select('id, first_name, last_name, active, roles:role_id(name)')
    .eq('active', true)
    .order('last_name', { ascending: true });
  return (data || [])
    .filter(u => (u.roles?.name || '') !== 'Client')
    .map(u => ({ id: u.id, first_name: u.first_name, last_name: u.last_name, role: u.roles?.name || null }));
}

async function loadClients(admin) {
  const { data } = await admin
    .from('clients')
    .select('id, first_name, last_name, active')
    .eq('active', true)
    .order('last_name', { ascending: true });
  return data || [];
}

async function handleGet(request, env) {
  const auth = await verifyAuth(request, env, 'read', 'billing');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const admin    = makeAdminClient(env);
  const clientId = new URL(request.url).searchParams.get('client_id');

  const [clients, staff] = await Promise.all([loadClients(admin), loadStaff(admin)]);
  const payload = { clients, staff };

  if (clientId) {
    const [ratesRes, chargeRes] = await Promise.all([
      admin.from('billing_rates')
        .select('id, user_id, role, rate')
        .eq('client_id', clientId),
      admin.from('recurring_charges')
        .select('id, amount, account_type, day_of_month, active')
        .eq('client_id', clientId)
        .eq('charge_type', 'admin_fee')
        .maybeSingle(),
    ]);
    payload.rates            = ratesRes.data || [];
    payload.recurring_charge = chargeRes.data || null;
  }

  return json(200, payload);
}

async function handlePost(request, env) {
  const auth = await verifyAuth(request, env, 'write', 'billing');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { client_id, rates = [], recurring_charge } = body;
  if (!client_id) return json(400, { error: 'client_id required' });

  const admin = makeAdminClient(env);

  // ── Per-person rates ──────────────────────────────────────────────────────
  // Empty/blank rate removes the row (staffer bills nothing special for this
  // client); a number upserts it.
  for (const r of rates) {
    if (!r.user_id) continue;
    const blank = r.rate === null || r.rate === undefined || r.rate === '';
    if (blank) {
      await admin.from('billing_rates')
        .delete().eq('client_id', client_id).eq('user_id', r.user_id);
      continue;
    }
    const rate = Number(r.rate);
    if (!Number.isFinite(rate) || rate < 0) return json(400, { error: `Invalid rate for user ${r.user_id}` });

    const { data: existing } = await admin.from('billing_rates')
      .select('id').eq('client_id', client_id).eq('user_id', r.user_id).maybeSingle();
    if (existing) {
      const { error } = await admin.from('billing_rates').update({ rate }).eq('id', existing.id);
      if (error) return json(500, { error: error.message });
    } else {
      const { error } = await admin.from('billing_rates')
        .insert({ client_id, user_id: r.user_id, rate, created_by: auth.profile.id });
      if (error) return json(500, { error: error.message });
    }
  }

  // ── Monthly admin fee (recurring charge) ──────────────────────────────────
  if (recurring_charge !== undefined) {
    const rc     = recurring_charge || {};
    const amount = Number(rc.amount);
    const active = !!rc.active;

    const { data: existing } = await admin.from('recurring_charges')
      .select('id').eq('client_id', client_id).eq('charge_type', 'admin_fee').maybeSingle();

    if (!active && !existing) {
      // Nothing to do — no fee, none stored.
    } else if (active && (!Number.isFinite(amount) || amount <= 0)) {
      return json(400, { error: 'Admin fee amount must be greater than zero' });
    } else {
      const fields = {
        amount:       Number.isFinite(amount) && amount > 0 ? amount : (existing ? undefined : 100),
        account_type: rc.account_type === 'trust' ? 'trust' : 'operating',
        day_of_month: Number(rc.day_of_month) >= 1 && Number(rc.day_of_month) <= 28 ? Number(rc.day_of_month) : 1,
        active,
      };
      if (existing) {
        const upd = { ...fields };
        if (upd.amount === undefined) delete upd.amount;
        const { error } = await admin.from('recurring_charges').update(upd).eq('id', existing.id);
        if (error) return json(500, { error: error.message });
      } else {
        const { error } = await admin.from('recurring_charges')
          .insert({ client_id, charge_type: 'admin_fee', description: 'Monthly administrative fee',
                    created_by: auth.profile.id, ...fields });
        if (error) return json(500, { error: error.message });
      }
    }
  }

  return json(200, { ok: true });
}
