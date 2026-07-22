// Per-client billing-rate resolution.
//
// Rates come from the signed client agreement, stored in `billing_rates`
// (client_id + user_id|role -> rate). This is the ONE place amounts are decided,
// so precedence is defined once, here:
//
//   1. per-client, per-PERSON rate      billing_rates(client_id, user_id)
//   2. per-client, per-ROLE  rate       billing_rates(client_id, role)
//   3. the accounting provider's rate    (FreshBooks billable_rate)  ← see note
//   4. the staff member's default rate   users.hourly_rate
//   5. 0
//
// NOTE on step 3 ("play with FreshBooks later"): FreshBooks currently returns 0
// for every entry (no rates configured there), so it never wins today. The
// portal agreement rate is intentionally authoritative OVER the provider rate —
// if a firm ever DOES set rates in FreshBooks and wants those to win, move the
// `providerRate` check above the userRate/roleRate checks in forIdentity().

import { createClient } from '@supabase/supabase-js';

// Build a resolver for one client. Does a small fixed number of queries up front
// (not per time entry), then resolves each entry in memory.
export async function buildRateResolver(admin, clientId) {
  const [ratesRes, mapRes] = await Promise.all([
    admin
      .from('billing_rates')
      .select('user_id, role, rate')
      .eq('client_id', clientId),
    admin
      .from('billing_identity_map')
      .select('identity_id, user_id, users:user_id(hourly_rate, roles:role_id(name))'),
  ]);

  const userRate = new Map(); // user_id -> rate
  const roleRate = new Map(); // role name -> rate
  for (const r of ratesRes.data || []) {
    if (r.user_id)   userRate.set(r.user_id, Number(r.rate));
    else if (r.role) roleRate.set(r.role, Number(r.rate));
  }

  // identity_id (string) -> { userId, role, hourlyRate }
  const identity = new Map();
  for (const m of mapRes.data || []) {
    identity.set(String(m.identity_id), {
      userId:     m.user_id || null,
      role:       m.users?.roles?.name || null,
      hourlyRate: m.users?.hourly_rate != null ? Number(m.users.hourly_rate) : null,
    });
  }

  return {
    // For a FreshBooks-sourced entry, keyed by the provider identity_id.
    // providerRate is the FreshBooks billable_rate (0 today).
    forIdentity(identityId, providerRate = 0) {
      const info = identity.get(String(identityId));
      if (info) {
        if (info.userId && userRate.has(info.userId)) return userRate.get(info.userId);
        if (info.role   && roleRate.has(info.role))   return roleRate.get(info.role);
        if (providerRate > 0)          return providerRate;   // ← flip point (see NOTE)
        if (info.hourlyRate != null)   return info.hourlyRate;
        return 0;
      }
      // No identity mapping: fall back to whatever the provider gave us.
      return providerRate > 0 ? providerRate : 0;
    },

    // For a portal-native entry, keyed by the portal user_id (+ role fallback).
    // Returns `fallback` (default null) when no per-client rate is on file, so
    // callers can chain to the entry's own rate or the user's default.
    forUser(userId, roleName, fallback = null) {
      if (userId   && userRate.has(userId))   return userRate.get(userId);
      if (roleName && roleRate.has(roleName)) return roleRate.get(roleName);
      return fallback;
    },
  };
}

// Convenience for callers that only have `env` (constructs an admin client).
export async function buildRateResolverFromEnv(env, clientId) {
  const admin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return buildRateResolver(admin, clientId);
}
