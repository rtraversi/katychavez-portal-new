import { verifyAuth, makeAdminClient, json } from './_helpers.js';
import { fetchConsumedExternalIds } from './_external-entry.js';
import { getBillingAdapter } from './_adapters/billing/index.js';
import { buildRateResolver } from './_billing-rates.js';
import { getBillingIncrementMinutes, roundHoursUpToIncrement } from './_billing-increment.js';

// Portal-native unbilled entries for a matter, priced with the per-client
// resolver and rounded up to the firm increment. Used standalone (no billing
// adapter) AND merged after provider-pulled entries (manual "Add time entry"
// rows must show up regardless of where the rest of the time comes from).
async function loadPortalEntries(admin, matterId, clientId) {
  const { data, error } = await admin
    .from('time_entries')
    .select(`
      id, entry_date, hours, rate, description, status,
      users!user_id(id, first_name, last_name, hourly_rate, roles:role_id(name))
    `)
    .eq('matter_id', matterId)
    .eq('status', 'unbilled')
    .is('deleted_at', null)
    .order('entry_date', { ascending: true });

  if (error) throw new Error(error.message);

  const [resolver, increment] = await Promise.all([
    clientId ? buildRateResolver(admin, clientId) : Promise.resolve(null),
    getBillingIncrementMinutes(admin),
  ]);

  return (data || []).map(e => {
    const perClient = resolver
      ? resolver.forUser(e.users?.id, e.users?.roles?.name, null)
      : null;
    // Precedence: explicit entry rate → per-client rate → user default → 0.
    // (rate 0 is an explicit no-charge entry and wins over the resolver.)
    const rate = e.rate ?? perClient ?? e.users?.hourly_rate ?? 0;
    // Manually-entered time follows the same firm increment as pulled time:
    // hours round UP to the block boundary, actual_hours keeps what was typed
    // so the UI can show the adjustment.
    const actualHours = Number(e.hours) || 0;
    const hours       = roundHoursUpToIncrement(actualHours, increment);
    return {
      ...e,
      hours,
      actual_hours: actualHours,
      effective_rate: rate,
      billable: Number(rate) !== 0,
      amount: Math.round(hours * rate * 100) / 100,
      source: 'portal',
    };
  });
}

// Firm staff (everyone but Clients) with their per-client rate — feeds both
// the FB-entry reassignment dropdown and the manual Add Time Entry form.
function mapStaff(staffRows, resolver) {
  return (staffRows || [])
    .filter(u => u.roles?.name !== 'Client')
    .map(u => ({
      user_id: u.id,
      name:    [u.first_name, u.last_name].filter(Boolean).join(' '),
      rate:    resolver
        ? (resolver.forUser(u.id, u.roles?.name, null)
           ?? (u.hourly_rate != null ? Number(u.hourly_rate) : 0))
        : (u.hourly_rate != null ? Number(u.hourly_rate) : 0),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'billing');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  const url      = new URL(request.url);
  const matterId = url.searchParams.get('matter_id');
  if (!matterId) return json(400, { error: 'matter_id required' });

  const admin = makeAdminClient(env);

  const { data: matter } = await admin
    .from('matters')
    .select('client_id, clients(id, email, first_name, last_name)')
    .eq('id', matterId)
    .single();
  if (!matter) return json(404, { error: 'Matter not found' });

  const clientId = matter.client_id || matter.clients?.id || null;

  // When a billing adapter is configured (e.g. FreshBooks), pull time entries
  // from the external system keyed by the matter's client. Rates are resolved
  // from the portal's per-client billing_rates (FreshBooks has none).
  const billingAdapter = getBillingAdapter(env);
  if (billingAdapter?.pullUnbilledTimeEntries) {
    try {
      const client  = matter.clients || {};
      const entries = await billingAdapter.pullUnbilledTimeEntries(
        matterId,
        client.email,
        clientId,
        { first_name: client.first_name, last_name: client.last_name },
      );

      // Provider entries carry identity_id (who logged the time in the external
      // system) but no portal user. Resolve identity -> portal user so the UI
      // can show who the time is attributed to, and return the firm's staff
      // with their per-client rates so an entry can be reassigned (rate and
      // amount are recomputed client-side from this list).
      const [{ data: idMap }, { data: staffRows }, resolver, portalEntries, consumed] = await Promise.all([
        admin
          .from('billing_identity_map')
          .select('identity_id, user_id, users:user_id(id, first_name, last_name)'),
        admin
          .from('users')
          .select('id, first_name, last_name, hourly_rate, roles:role_id(name)')
          .eq('active', true),
        clientId ? buildRateResolver(admin, clientId) : Promise.resolve(null),
        loadPortalEntries(admin, matterId, clientId),
        fetchConsumedExternalIds(admin),
      ]);

      // The provider never learns its entries were invoiced here (FB's billed
      // flag stays false), so filter out entries already on a live portal
      // invoice or they'd be billable twice. Void frees them again (1533).
      const available = entries.filter(e => !consumed.has(e.id));

      const byIdentity = new Map(
        (idMap || []).filter(m => m.users).map(m => [String(m.identity_id), m.users])
      );
      for (const e of available) {
        if (e.identity_id != null && !e.users) {
          e.users = byIdentity.get(String(e.identity_id)) || null;
        }
      }

      // Manual portal entries ride along with the pulled ones, oldest first.
      const merged = [...available, ...portalEntries].sort((a, b) =>
        String(a.entry_date || '').localeCompare(String(b.entry_date || '')));

      return json(200, { time_entries: merged, staff: mapStaff(staffRows, resolver), source: env.BILLING_PROVIDER });
    } catch (err) {
      // err.message is written to be client-facing (e.g. email-mismatch guidance)
      return json(502, { error: err.message });
    }
  }

  // Default: portal time_entries only (no external billing system)
  try {
    const [entries, { data: staffRows }, resolver] = await Promise.all([
      loadPortalEntries(admin, matterId, clientId),
      admin
        .from('users')
        .select('id, first_name, last_name, hourly_rate, roles:role_id(name)')
        .eq('active', true),
      clientId ? buildRateResolver(admin, clientId) : Promise.resolve(null),
    ]);
    return json(200, { time_entries: entries, staff: mapStaff(staffRows, resolver), source: 'portal' });
  } catch (err) {
    return json(500, { error: err.message });
  }
}
