// Bank Accounts (bank feeds): shared logic for the API route and the daily cron.
// NOT a route endpoint (underscore prefix).
//
// A sync pulls one connection's accounts + transactions from its provider and upserts
// them. The provider credential lives encrypted in bank_connection_secrets, which only the
// service role can read, and it is decrypted only here, in the Worker.

import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { makeAdminClient } from './_helpers.js';
import { getBankFeedAdapter, BankFeedError } from './_adapters/bank-feed/index.js';

export const MODULE_KEY = 'bank_feeds';

const DAY_S = 86400;
// First sync reaches back this far, fetched in provider-sized windows (splitWindow).
export const INITIAL_DAYS = 90;
// Later syncs re-read this much overlap, because banks post late and revise descriptions.
export const OVERLAP_DAYS = 14;
// Minimum gap between manual "Sync now" presses. SimpleFIN allows 24 requests/day and
// only refreshes from the bank about once a day, so pressing harder buys nothing.
export const MANUAL_SYNC_MIN_GAP_MS = 10 * 60 * 1000;

const UPSERT_CHUNK = 500;

// ── Credential encryption (AES-256-GCM) ─────────────────────────────────────
// Key: BANK_FEED_ENCRYPTION_KEY (64-char hex = 32 bytes), else SSN_ENCRYPTION_KEY, which
// every deployment already has. A dedicated key lets a firm rotate one without the other.
// Stored format: hex(iv):hex(authTag):hex(ciphertext), same as ssnEncrypt.

function secretKey(env) {
  const keyHex = env.BANK_FEED_ENCRYPTION_KEY || env.SSN_ENCRYPTION_KEY;
  if (!keyHex || !/^[0-9a-fA-F]{64}$/.test(keyHex)) {
    throw new Error('BANK_FEED_ENCRYPTION_KEY (or SSN_ENCRYPTION_KEY) is not configured as 64-char hex');
  }
  return Buffer.from(keyHex, 'hex');
}

export function isEncryptionConfigured(env) {
  try { secretKey(env); return true; } catch { return false; }
}

export function encryptSecret(plaintext, env) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', secretKey(env), iv);
  const enc = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${cipher.getAuthTag().toString('hex')}:${enc.toString('hex')}`;
}

export function decryptSecret(stored, env) {
  const parts = String(stored || '').split(':');
  if (parts.length !== 3) throw new Error('Invalid encrypted bank-feed secret');
  const [ivHex, tagHex, encHex] = parts;
  const decipher = createDecipheriv('aes-256-gcm', secretKey(env), Buffer.from(ivHex, 'hex'));
  decipher.setAuthTag(Buffer.from(tagHex, 'hex'));
  return Buffer.concat([decipher.update(Buffer.from(encHex, 'hex')), decipher.final()]).toString('utf8');
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export async function isModuleEnabled(admin) {
  const { data } = await admin.from('enabled_modules').select('module_key').eq('module_key', MODULE_KEY).maybeSingle();
  return !!data;
}

// Which days to ask the provider for, in seconds since epoch.
export function syncWindow(connection, now = new Date()) {
  const end = Math.floor(now.getTime() / 1000);
  const floor = end - INITIAL_DAYS * DAY_S;
  if (!connection?.last_synced_at) return { start: floor, end };
  const since = Math.floor(new Date(connection.last_synced_at).getTime() / 1000) - OVERLAP_DAYS * DAY_S;
  return { start: Math.max(floor, since), end };
}

// Split { start, end } into consecutive windows no longer than maxDays, oldest first.
// The provider caps how much one request may cover; a first sync wants more than that.
export function splitWindow({ start, end }, maxDays) {
  const span = Math.max(1, Math.floor(maxDays)) * DAY_S;
  const out = [];
  for (let s = start; s < end; s += span) out.push({ start: s, end: Math.min(s + span, end) });
  return out.length ? out : [{ start, end }];
}

// Merge the answers for several windows (oldest first) into one account set. Account
// details and balances come from the newest answer; transactions are combined, the newer
// copy winning when a window boundary returns the same one twice.
export function mergeAccountSets(sets) {
  const accounts = new Map();
  const warnings = new Set();
  for (const set of sets) {
    set.warnings.forEach(w => warnings.add(w));
    for (const a of set.accounts) {
      const prev = accounts.get(a.providerAccountId);
      const txns = new Map((prev?.transactions || []).map(t => [t.providerTxnId, t]));
      a.transactions.forEach(t => txns.set(t.providerTxnId, t));
      accounts.set(a.providerAccountId, { ...a, transactions: [...txns.values()] });
    }
  }
  return { accounts: [...accounts.values()], warnings: [...warnings] };
}

// Seconds until a manual sync is allowed again (0 = now).
export function manualSyncWaitSeconds(connection, now = new Date()) {
  if (!connection?.last_attempt_at) return 0;
  const elapsed = now.getTime() - new Date(connection.last_attempt_at).getTime();
  return elapsed >= MANUAL_SYNC_MIN_GAP_MS ? 0 : Math.ceil((MANUAL_SYNC_MIN_GAP_MS - elapsed) / 1000);
}

function chunks(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ── Store one normalized account set ────────────────────────────────────────
// Upserts accounts, then their transactions. Returns { accounts, transactions }.
// Accounts the provider stopped reporting are flagged present=false, but only on a clean
// response: when the provider sent warnings, a missing account more likely means the bank
// was unreachable than that the account closed.
export async function storeAccountSet(admin, connectionId, set) {
  const accountRows = set.accounts.map(a => ({
    connection_id: connectionId,
    provider_account_id: a.providerAccountId,
    name: a.name,
    institution: a.institution,
    currency: a.currency,
    balance: a.balance,
    available_balance: a.availableBalance,
    balance_date: a.balanceDate,
    present: true,
  }));

  const idByProvider = new Map();
  if (accountRows.length) {
    const { data, error } = await admin
      .from('bank_accounts')
      .upsert(accountRows, { onConflict: 'connection_id,provider_account_id' })
      .select('id, provider_account_id');
    if (error) throw new Error(`bank_accounts upsert failed: ${error.message}`);
    for (const r of data || []) idByProvider.set(r.provider_account_id, r.id);
  }

  if (!set.warnings.length) {
    const seen = accountRows.map(r => r.provider_account_id);
    let q = admin.from('bank_accounts').update({ present: false })
      .eq('connection_id', connectionId).eq('present', true);
    if (seen.length) q = q.not('provider_account_id', 'in', `(${seen.map(s => `"${s.replace(/"/g, '""')}"`).join(',')})`);
    const { error } = await q;
    if (error) throw new Error(`bank_accounts present flag update failed: ${error.message}`);
  }

  const txnRows = [];
  for (const a of set.accounts) {
    const accountId = idByProvider.get(a.providerAccountId);
    if (!accountId) continue;
    for (const t of a.transactions) {
      txnRows.push({
        account_id: accountId,
        provider_txn_id: t.providerTxnId,
        posted_at: t.postedAt,
        transacted_at: t.transactedAt,
        amount: t.amount,
        description: t.description,
        payee: t.payee,
        memo: t.memo,
      });
    }
  }
  for (const part of chunks(txnRows, UPSERT_CHUNK)) {
    const { error } = await admin.from('bank_transactions')
      .upsert(part, { onConflict: 'account_id,provider_txn_id' });
    if (error) throw new Error(`bank_transactions upsert failed: ${error.message}`);
  }

  return { accounts: accountRows.length, transactions: txnRows.length };
}

// ── Sync one connection ─────────────────────────────────────────────────────
// Never throws for provider trouble: the outcome is recorded on the connection and
// returned as { ok:false, error, kind }. Throws only for the portal's own failures
// (database, missing key).
export async function syncConnection(admin, env, connection, { now = new Date(), fetchFn } = {}) {
  const attemptAt = now.toISOString();

  const { data: secretRow, error: secErr } = await admin
    .from('bank_connection_secrets').select('secret_enc').eq('connection_id', connection.id).maybeSingle();
  if (secErr) throw new Error(`bank_connection_secrets read failed: ${secErr.message}`);
  if (!secretRow) {
    const msg = 'This connection has no stored credential. Disconnect it and connect again.';
    await admin.from('bank_connections').update({ status: 'revoked', last_attempt_at: attemptAt, last_error: msg }).eq('id', connection.id);
    return { ok: false, kind: 'revoked', error: msg };
  }

  const adapter = getBankFeedAdapter(connection.provider, env, fetchFn);
  let set;
  try {
    const secret = decryptSecret(secretRow.secret_enc, env);
    const sets = [];
    for (const w of splitWindow(syncWindow(connection, now), adapter.maxWindowDays)) {
      sets.push(await adapter.fetchAccounts(secret, w));
    }
    set = mergeAccountSets(sets);
  } catch (err) {
    if (!(err instanceof BankFeedError)) throw err;
    const patch = { last_attempt_at: attemptAt, last_error: err.message };
    if (err.kind === 'revoked') patch.status = 'revoked';
    await admin.from('bank_connections').update(patch).eq('id', connection.id);
    return { ok: false, kind: err.kind, error: err.message };
  }

  const stored = await storeAccountSet(admin, connection.id, set);
  const warning = set.warnings.length ? set.warnings.join(' ') : null;
  const { error: updErr } = await admin.from('bank_connections').update({
    status: 'active',
    last_attempt_at: attemptAt,
    last_synced_at: attemptAt,
    last_error: warning,
  }).eq('id', connection.id);
  if (updErr) throw new Error(`bank_connections update failed: ${updErr.message}`);

  return { ok: true, ...stored, warning };
}

// ── Daily refresh (cron) ────────────────────────────────────────────────────
// One request per active connection per day, well inside SimpleFIN's 24/day. No-ops
// unless the module is enabled and an encryption key is configured.
export async function runBankFeedRefresh(env, { now = new Date(), fetchFn } = {}) {
  if (!isEncryptionConfigured(env)) return { skipped: 'not_configured' };
  const admin = makeAdminClient(env);
  if (!(await isModuleEnabled(admin))) return { skipped: 'module_disabled' };

  const { data: connections, error } = await admin
    .from('bank_connections').select('*').eq('status', 'active');
  if (error) {
    console.error('[bank-feeds] could not read connections:', error.message);
    return { skipped: 'db_error' };
  }

  const result = { synced: 0, failed: 0 };
  for (const c of connections || []) {
    try {
      const r = await syncConnection(admin, env, c, { now, fetchFn });
      if (r.ok) result.synced++; else result.failed++;
    } catch (err) {
      console.error('[bank-feeds] sync failed for connection', c.id, err.message);
      result.failed++;
    }
  }
  return result;
}
