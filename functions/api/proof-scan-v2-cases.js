// proof-scan-v2-cases.js: find Proof Scan cases (D-83).
//
//   GET ?q=<client name or A-Number>   matching cases, newest first
//   GET                                 the most recent cases
//
// A query with seven to nine digits (any "A-" or dashes ignored) is also looked
// up as an A-Number on every person in every case.

import { requireStaff, json, guarded, methodNotAllowed } from './_proof-scan-v2-http.js';
import * as store from './_proof-scan-v2-store.js';
import { CASE_TYPE_LABELS, normalizeANumber } from './_proof-scan-v2-common.js';

const LIMIT = 25;

const listRow = (c) => ({
  id: c.id, label: c.label, case_type: c.case_type,
  case_type_label: CASE_TYPE_LABELS[c.case_type], created_at: c.created_at,
});

export const onRequest = guarded('proof-scan-v2-cases', async ({ request, env }) => {
  if (request.method !== 'GET') return methodNotAllowed();
  const gate = await requireStaff(request, env, 'read');
  if (gate.response) return gate.response;

  const q = (new URL(request.url).searchParams.get('q') || '').trim().slice(0, 100);
  if (!q) return json(200, { cases: (await store.recentCases(gate.admin, LIMIT)).map(listRow) });

  // ilike wildcards in the search text are matched literally.
  const term = q.replace(/[%_\\]/g, (c) => `\\${c}`);
  const byLabel = await store.searchCasesByLabel(gate.admin, term, LIMIT);

  let byANumber = [];
  const aNumber = /^[\sAa#-]*[\d\s-]+$/.test(q) ? normalizeANumber(q) : null;
  if (aNumber) {
    const people = await store.peopleByANumber(gate.admin, aNumber);
    byANumber = await store.getCasesByIds(gate.admin, [...new Set(people.map((p) => p.case_id))]);
  }

  const seen = new Set();
  const cases = [...byANumber, ...byLabel]
    .filter((c) => (seen.has(c.id) ? false : seen.add(c.id)))
    .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
    .slice(0, LIMIT)
    .map(listRow);
  return json(200, { cases });
});
