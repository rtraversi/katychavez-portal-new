// proof-scan-v2-editions.js: run the USCIS edition check now (D-128).
//
//   POST {}   staff (Proof Scan write) only
//
// Max, 2026-10-15: "if we notice that the editions changed and the weekly
// check is not yet passed, we can let it know with a button, and it can check
// in that moment". The same check the Monday cron runs
// (process-form-edition-check.js), with D-127's accepted editions, answered
// here so staff see the outcome. The weekly run stays.
//
// A run less than a minute after the last one is refused, so a double click
// never sends USCIS every request twice.

import { requireStaff, json, guarded, methodNotAllowed } from './_proof-scan-v2-http.js';
import { run as runFormEditionCheck } from './process-form-edition-check.js';

export const MIN_INTERVAL_MS = 60_000;

export const onRequest = guarded('proof-scan-v2-editions', async ({ request, env }) => {
  if (request.method !== 'POST') return methodNotAllowed();
  const gate = await requireStaff(request, env, 'write');
  if (gate.response) return gate.response;

  const { data: last } = await gate.admin.from('form_editions')
    .select('last_checked_at').order('last_checked_at', { ascending: false, nullsFirst: false }).limit(1);
  const at = Date.parse(last?.[0]?.last_checked_at || '');
  if (Number.isFinite(at) && Date.now() - at < MIN_INTERVAL_MS) {
    return json(429, { error: 'The edition check just ran. Try again in a minute.' });
  }

  const outcome = await runFormEditionCheck(env, gate.admin);
  return json(200, {
    checked: outcome.checked,
    stale: outcome.stale,
    errored: outcome.errored,
    changed: outcome.changed || [],
    unclear: outcome.unclear || [],
  });
});
