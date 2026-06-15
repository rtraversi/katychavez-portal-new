// POST /api/run-conflict-check
// Staff-only: search for potential conflicts of interest by name.
// Searches clients and opposing_parties tables using ILIKE matching.
// Logs every check to conflict_checks for the audit trail.
//
// Body for a new search:
//   { prospective_client_name, opposing_party_name?, additional_names?: string[] }
//
// Body to save a decision on an existing check:
//   { save: true, check_id, outcome: 'clear'|'conflict'|'review_needed', notes? }

import { verifyAuth, makeAdminClient, json } from './_helpers.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'core');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const admin = makeAdminClient(env);

  // ── Save decision on existing check ─────────────────────────────────────────
  if (body.save) {
    const { check_id, outcome, notes } = body;
    if (!check_id) return json(400, { error: 'check_id is required.' });
    if (!['clear', 'conflict', 'review_needed'].includes(outcome)) {
      return json(400, { error: 'outcome must be clear, conflict, or review_needed.' });
    }
    const { error } = await admin
      .from('conflict_checks')
      .update({ outcome, notes: notes?.trim() || null })
      .eq('id', check_id);
    if (error) {
      console.error('[run-conflict-check] save decision:', error.message);
      return json(500, { error: 'Failed to save decision.' });
    }
    return json(200, { ok: true });
  }

  // ── Run a new search ─────────────────────────────────────────────────────────
  const { prospective_client_name, opposing_party_name, additional_names = [] } = body;
  if (!prospective_client_name?.trim()) {
    return json(400, { error: 'prospective_client_name is required.' });
  }

  const namesToSearch = [
    prospective_client_name.trim(),
    opposing_party_name?.trim(),
    ...(Array.isArray(additional_names) ? additional_names : []),
  ].filter(Boolean);

  const seen  = new Set();
  const matches = [];

  for (const fullName of namesToSearch) {
    // Split into tokens (first + last) and search each separately
    const tokens = fullName.split(/\s+/).filter(t => t.length >= 2);
    if (!tokens.length) continue;

    // Search clients table
    for (const token of tokens) {
      const { data: clients } = await admin
        .from('clients')
        .select('id, first_name, last_name, email, matters(id, case_type, status, case_number)')
        .or(`first_name.ilike.%${token}%,last_name.ilike.%${token}%`)
        .eq('active', true)
        .limit(15);

      for (const c of (clients || [])) {
        const key = `client:${c.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        matches.push({
          type:        'existing_client',
          entity_id:   c.id,
          name:        `${c.first_name} ${c.last_name}`.trim(),
          email:       c.email || null,
          matched_in:  'Existing Clients',
          searched_for: fullName,
          matters:     (c.matters || []).map(m => ({
            id: m.id, case_type: m.case_type, status: m.status, case_number: m.case_number,
          })),
        });
      }
    }

    // Search opposing_parties table
    for (const token of tokens) {
      const { data: opps } = await admin
        .from('opposing_parties')
        .select('id, first_name, last_name, matter_id')
        .or(`first_name.ilike.%${token}%,last_name.ilike.%${token}%`)
        .limit(15);

      if (!opps?.length) continue;

      // Fetch matter + client context for each opp match
      const matterIds = [...new Set(opps.map(op => op.matter_id))];
      const { data: matters } = await admin
        .from('matters')
        .select('id, case_type, status, case_number, client_id, clients(id, first_name, last_name)')
        .in('id', matterIds);

      const matterMap = Object.fromEntries((matters || []).map(m => [m.id, m]));

      for (const op of opps) {
        const key = `opp:${op.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const matter = matterMap[op.matter_id];
        const client = matter?.clients;
        matches.push({
          type:        'opposing_party',
          entity_id:   op.id,
          name:        `${op.first_name} ${op.last_name || ''}`.trim(),
          matched_in:  'Opposing Parties',
          searched_for: fullName,
          related_client: client ? `${client.first_name} ${client.last_name}`.trim() : null,
          related_client_id: client?.id || null,
          matter:      matter ? {
            id: matter.id, case_type: matter.case_type,
            status: matter.status, case_number: matter.case_number,
          } : null,
        });
      }
    }
  }

  // Log check to audit table (best-effort — don't fail if insert fails)
  const { data: checkRow } = await admin
    .from('conflict_checks')
    .insert({
      checked_by:              auth.profile.id,
      prospective_client_name: prospective_client_name.trim(),
      opposing_party_name:     opposing_party_name?.trim() || null,
      additional_names:        (additional_names || []).filter(Boolean),
      matches_found:           matches,
    })
    .select('id')
    .single();

  return json(200, {
    check_id:    checkRow?.id || null,
    matches,
    total_found: matches.length,
  });
}
