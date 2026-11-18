// POST /api/bank-feeds
// Connect, sync, or disconnect a bank feed. Owner only by default (bank_feeds module).
//
//   { action: 'connect',    setup_token, label? }   claim a provider token, then sync once
//   { action: 'sync',       id }                    pull the latest now (throttled)
//   { action: 'disconnect', id }                    delete the link and everything it pulled
//   { action: 'import', account_id, entries, categories?, category_map?, dry_run? }
//                                                   add Quicken history to an account and
//                                                   categorize what the feed already has
//                                                   (_bank-import.js). dry_run only reports.
//
// The page reads accounts, transactions and connection status straight from the tables
// (RLS, can_read('bank_feeds')). Everything that calls the provider or writes
// transactions goes through here, because the provider credential never leaves the Worker
// and transactions are only ever written by the service role.

import { verifyAuth, json } from './_helpers.js';
import { getBankFeedAdapter, BankFeedError } from './_adapters/bank-feed/index.js';
import {
  MODULE_KEY, isModuleEnabled, isEncryptionConfigured, encryptSecret,
  syncConnection, manualSyncWaitSeconds,
} from './_bank-feeds.js';
import { runImport, MAX_ENTRIES } from './_bank-import.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const NOT_CONFIGURED = 'Bank feeds are not configured on this portal: set BANK_FEED_ENCRYPTION_KEY (64-char hex) or SSN_ENCRYPTION_KEY.';

// Who may do what. Viewing needs only read (RLS). Pulling fresh data needs write;
// adding or removing a bank link, or loading history in bulk, needs admin.
const LEVEL = { connect: 'admin', disconnect: 'admin', sync: 'write', import: 'admin' };

const STATUS_FOR_KIND = {
  invalid_token: 422,
  already_claimed: 409,
  revoked: 409,
  unavailable: 502,
  bad_response: 502,
};

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON body' }); }
  const action = body?.action;
  if (!LEVEL[action]) return json(400, { error: 'Unknown action.' });

  const auth = await verifyAuth(request, env, LEVEL[action], MODULE_KEY);
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  const { admin, profile } = auth;

  if (!(await isModuleEnabled(admin))) return json(409, { error: 'Bank Accounts is not enabled for this firm.' });

  // ── import (no provider call, so no credential key needed) ───────────────
  if (action === 'import') {
    if (!UUID_RE.test(body.account_id || '')) return json(400, { error: 'Choose the account to import into.' });
    if (!Array.isArray(body.entries) || !body.entries.length) return json(422, { error: 'The file has no transactions to import.' });
    if (body.entries.length > MAX_ENTRIES) {
      return json(422, { error: `That file has ${body.entries.length} transactions; the limit is ${MAX_ENTRIES} at a time. Export a shorter date range.` });
    }
    const { data: acct } = await admin.from('bank_accounts').select('id').eq('id', body.account_id).maybeSingle();
    if (!acct) return json(404, { error: 'That account no longer exists.' });
    try {
      const result = await runImport(admin, {
        accountId: acct.id,
        entries: body.entries,
        fileCategories: Array.isArray(body.categories) ? body.categories.slice(0, 2000) : [],
        categoryMap: body.category_map,
        dryRun: body.dry_run !== false,
        userId: profile?.id,
      });
      return json(200, { import: result });
    } catch (err) {
      console.error('[bank-feeds] import failed:', err.message);
      return json(500, { error: 'The import stopped partway. Running it again is safe: it only adds what is still missing.' });
    }
  }

  if (!isEncryptionConfigured(env)) return json(503, { error: NOT_CONFIGURED });

  // ── disconnect ────────────────────────────────────────────────────────────
  if (action === 'disconnect') {
    if (!UUID_RE.test(body.id || '')) return json(400, { error: 'A valid id is required.' });
    // Cascades to the secret, the accounts and their transactions.
    const { data, error } = await admin.from('bank_connections').delete().eq('id', body.id).select('id');
    if (error) return json(500, { error: 'Could not remove the connection.' });
    if (!data?.length) return json(404, { error: 'That connection no longer exists.' });
    return json(200, { removed: body.id });
  }

  // ── sync ──────────────────────────────────────────────────────────────────
  if (action === 'sync') {
    if (!UUID_RE.test(body.id || '')) return json(400, { error: 'A valid id is required.' });
    const { data: conn } = await admin.from('bank_connections').select('*').eq('id', body.id).maybeSingle();
    if (!conn) return json(404, { error: 'That connection no longer exists.' });
    if (conn.status === 'revoked') {
      return json(409, { error: conn.last_error || 'This connection was revoked. Disconnect it and connect again.' });
    }
    const wait = manualSyncWaitSeconds(conn);
    if (wait > 0) {
      return json(429, {
        error: `Synced moments ago. The bank only updates about once a day, so try again in ${Math.ceil(wait / 60)} min.`,
        retry_after: wait,
      });
    }
    const result = await syncConnection(admin, env, conn);
    return result.ok ? json(200, { sync: result }) : json(STATUS_FOR_KIND[result.kind] || 502, { error: result.error, sync: result });
  }

  // ── connect ───────────────────────────────────────────────────────────────
  const provider = body.provider || 'simplefin';
  let adapter;
  try { adapter = getBankFeedAdapter(provider, env); } catch { return json(400, { error: 'Unknown provider.' }); }

  const token = String(body.setup_token || '').trim();
  if (!token) return json(422, { error: 'Paste the setup token from SimpleFIN Bridge.' });
  if (token.length > 2048) return json(422, { error: 'That setup token is too long to be a SimpleFIN token.' });
  const label = String(body.label || '').trim().slice(0, 80) || 'Bank connection';

  // Write the connection row BEFORE claiming. The claim spends the token for good, so the
  // database should be proven writable first.
  const { data: conn, error: insErr } = await admin.from('bank_connections')
    .insert({ provider, label, created_by: profile.id })
    .select('*').single();
  if (insErr || !conn) return json(500, { error: 'Could not save the connection. Nothing was sent to SimpleFIN; try again.' });

  let secret;
  try {
    secret = await adapter.claim(token);
  } catch (err) {
    await admin.from('bank_connections').delete().eq('id', conn.id);
    if (err instanceof BankFeedError) return json(STATUS_FOR_KIND[err.kind] || 502, { error: err.message });
    throw err;
  }

  const { error: secErr } = await admin.from('bank_connection_secrets')
    .insert({ connection_id: conn.id, secret_enc: encryptSecret(secret, env) });
  if (secErr) {
    await admin.from('bank_connections').delete().eq('id', conn.id);
    return json(500, {
      error: 'SimpleFIN accepted the token but the portal could not store the credential. That token is now used up: delete the app connection in SimpleFIN Bridge, create a new one, and connect again.',
    });
  }

  const sync = await syncConnection(admin, env, conn);
  const { data: fresh } = await admin.from('bank_connections').select('*').eq('id', conn.id).maybeSingle();
  return json(200, { connection: fresh || conn, sync });
}
