// SimpleFIN bank-feed adapter. https://www.simplefin.org/protocol.html
//
// Flow:
//   1. The firm makes a "setup token" at SimpleFIN Bridge (bridge.simplefin.org) and pastes
//      it into the portal. The token is a base64-encoded claim URL.
//   2. claim(): POST to the claim URL, once. SimpleFIN answers with an Access URL whose
//      userinfo holds Basic Auth credentials (https://user:pass@host/path). The token is
//      single-use: a second claim gets 403.
//   3. fetchAccounts(): GET <access URL>/accounts with those credentials as an
//      Authorization header. Workers' fetch refuses URLs with credentials in them, so they
//      are always split out.
//
// Provider rules this adapter keeps (SimpleFIN Bridge developer page):
//   • at most 24 requests a day per access URL  (callers sync once a day, plus a throttled
//     manual "Sync now")
//   • /accounts covers at most 90 days per request, and the Bridge warns past 45 days
//     ("Requested date range exceeds recommended range of 45 days. In the future, this may
//     be capped."), so one request asks for at most 45 (clampWindow). Callers wanting
//     more history split it into windows of maxWindowDays (see syncConnection).
//
// Every SimpleFIN host must be on an allowlist. A setup token is pasted text that decodes
// to a URL the Worker then POSTs to, so without the check it could point the Worker
// anywhere. Default: simplefin.org and its subdomains. Override with
// BANK_FEED_SIMPLEFIN_HOSTS (comma-separated) for a bank that runs its own SimpleFIN
// server.

export const PROVIDER = 'simplefin';
export const MAX_WINDOW_DAYS = 45;
const DAY_S = 86400;
const TIMEOUT_MS = 25000;

export class BankFeedError extends Error {
  // kind: 'invalid_token' | 'already_claimed' | 'revoked' | 'unavailable' | 'bad_response'
  constructor(kind, message, status = null) {
    super(message);
    this.name = 'BankFeedError';
    this.kind = kind;
    this.status = status;
  }
}

function allowedHosts(env) {
  const raw = env?.BANK_FEED_SIMPLEFIN_HOSTS;
  const list = raw ? String(raw).split(',') : ['simplefin.org'];
  return list.map(h => h.trim().toLowerCase()).filter(Boolean);
}

export function isAllowedHost(hostname, env) {
  const host = String(hostname || '').toLowerCase();
  return allowedHosts(env).some(h => host === h || host.endsWith('.' + h));
}

// Setup token → claim URL. Throws BankFeedError('invalid_token') with a message the Owner
// can act on.
export function decodeSetupToken(token, env) {
  const cleaned = String(token || '').replace(/\s+/g, '');
  if (!cleaned) throw new BankFeedError('invalid_token', 'Paste the setup token from SimpleFIN Bridge.');

  let decoded;
  try {
    decoded = atob(cleaned.replace(/-/g, '+').replace(/_/g, '/'));
  } catch {
    throw new BankFeedError('invalid_token', 'That does not look like a SimpleFIN setup token. Copy the whole token from SimpleFIN Bridge and try again.');
  }

  let url;
  try { url = new URL(decoded.trim()); } catch {
    throw new BankFeedError('invalid_token', 'That does not look like a SimpleFIN setup token. Copy the whole token from SimpleFIN Bridge and try again.');
  }
  if (url.protocol !== 'https:') {
    throw new BankFeedError('invalid_token', 'That setup token does not point to a secure (https) SimpleFIN address.');
  }
  if (!isAllowedHost(url.hostname, env)) {
    throw new BankFeedError('invalid_token', `That setup token points to ${url.hostname}, which is not a SimpleFIN address this portal accepts.`);
  }
  return url.toString();
}

// Access URL → { base, authorization } with the credentials taken out of the URL.
export function splitAccessUrl(accessUrl, env) {
  let url;
  try { url = new URL(String(accessUrl || '').trim()); } catch {
    throw new BankFeedError('bad_response', 'SimpleFIN returned an access address the portal could not read.');
  }
  if (url.protocol !== 'https:' || !isAllowedHost(url.hostname, env)) {
    throw new BankFeedError('bad_response', 'SimpleFIN returned an access address outside the allowed SimpleFIN hosts.');
  }
  if (!url.username) {
    throw new BankFeedError('bad_response', 'SimpleFIN returned an access address without credentials.');
  }
  const user = decodeURIComponent(url.username);
  const pass = decodeURIComponent(url.password);
  url.username = '';
  url.password = '';
  const base = url.toString().replace(/\/+$/, '');
  return { base, authorization: 'Basic ' + btoa(`${user}:${pass}`) };
}

// Clamp a sync window to what one /accounts request may cover. Seconds since epoch.
export function clampWindow(startS, endS) {
  const end = Math.floor(endS);
  const start = Math.max(Math.floor(startS), end - MAX_WINDOW_DAYS * DAY_S);
  return { start, end };
}

// ── Normalization ───────────────────────────────────────────────────────────

const DECIMAL_RE = /^-?\d+(\.\d+)?$/;

// SimpleFIN sends money as decimal strings. Keep them as strings so Postgres numeric
// stores exactly what was sent. Anything else becomes null.
export function decimalOrNull(v) {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return DECIMAL_RE.test(s) ? s : null;
}

export function epochToIso(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return new Date(n * 1000).toISOString();
}

const str = (v) => (v === null || v === undefined || v === '') ? null : String(v);

// One SimpleFIN Account Set → the portal's provider-neutral shape:
//   { accounts: [{ providerAccountId, name, institution, currency, balance,
//                  availableBalance, balanceDate, transactions: [...] }],
//     warnings: [string] }
//
// Handles both response generations: the original one (`errors: [string]`, an `org` on
// each account) and the newer one (`errlist: [{code,msg}]`, `connections` referenced by
// `conn_id`). Pending transactions (no posted date) are left out; they come back posted.
export function normalizeAccountSet(set) {
  const connections = new Map((Array.isArray(set?.connections) ? set.connections : [])
    .map(c => [c?.conn_id, c]));

  const warnings = [
    ...(Array.isArray(set?.errors) ? set.errors : []).map(e => str(typeof e === 'string' ? e : e?.msg)),
    ...(Array.isArray(set?.errlist) ? set.errlist : []).map(e => str(e?.msg || e?.code)),
  ].filter(Boolean);

  const accounts = (Array.isArray(set?.accounts) ? set.accounts : [])
    .filter(a => a && a.id !== undefined && a.id !== null)
    .map(a => {
      const balance = decimalOrNull(a.balance);
      // available-balance is omitted when it equals balance.
      const available = decimalOrNull(a['available-balance']) ?? balance;
      const transactions = (Array.isArray(a.transactions) ? a.transactions : [])
        .filter(t => t && t.id !== undefined && !t.pending && epochToIso(t.posted) && decimalOrNull(t.amount) !== null)
        .map(t => ({
          providerTxnId: String(t.id),
          postedAt: epochToIso(t.posted),
          transactedAt: epochToIso(t.transacted_at),
          amount: decimalOrNull(t.amount),
          description: str(t.description),
          payee: str(t.payee),
          memo: str(t.memo),
        }));
      return {
        providerAccountId: String(a.id),
        name: str(a.name) || String(a.id),
        institution: str(a.org?.name) || str(connections.get(a.conn_id)?.name),
        currency: str(a.currency) || 'USD',
        balance,
        availableBalance: available,
        balanceDate: epochToIso(a['balance-date']),
        transactions,
      };
    });

  return { accounts, warnings };
}

// ── Adapter ─────────────────────────────────────────────────────────────────

async function timedFetch(fetchFn, url, init) {
  try {
    return await fetchFn(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    throw new BankFeedError('unavailable', `Could not reach SimpleFIN (${err?.name === 'TimeoutError' ? 'timed out' : 'network error'}). Try again later.`, 0);
  }
}

export class SimpleFinAdapter {
  constructor(env = {}, fetchFn = (...a) => fetch(...a)) {
    this.env = env;
    this.fetch = fetchFn;
  }

  get provider() { return PROVIDER; }
  get maxWindowDays() { return MAX_WINDOW_DAYS; }

  // Setup token → the credential to store (the Access URL). One-shot: the token is spent
  // whether or not the caller manages to store the result.
  async claim(setupToken) {
    const claimUrl = decodeSetupToken(setupToken, this.env);
    // No redirects: a redirect could send the POST to a host the allowlist never saw.
    const res = await timedFetch(this.fetch, claimUrl, { method: 'POST', redirect: 'manual', body: '' });
    if (res.status === 403) {
      throw new BankFeedError('already_claimed', 'SimpleFIN says this setup token was already used. Each token works once: create a new one in SimpleFIN Bridge (New app connection) and paste that.', 403);
    }
    if (!res.ok) {
      throw new BankFeedError('unavailable', `SimpleFIN could not claim the setup token (HTTP ${res.status}). Try again in a few minutes.`, res.status);
    }
    const accessUrl = (await res.text()).trim();
    splitAccessUrl(accessUrl, this.env); // validate before anyone stores it
    return accessUrl;
  }

  // Credential + window (seconds since epoch) → normalized account set.
  async fetchAccounts(accessUrl, { start, end }) {
    const { base, authorization } = splitAccessUrl(accessUrl, this.env);
    const w = clampWindow(start, end);
    const url = `${base}/accounts?start-date=${w.start}&end-date=${w.end}`;
    const res = await timedFetch(this.fetch, url, { headers: { Authorization: authorization, Accept: 'application/json' }, redirect: 'manual' });

    if (res.status === 401 || res.status === 403) {
      throw new BankFeedError('revoked', 'SimpleFIN refused this connection: access was revoked or the app was deleted in SimpleFIN Bridge. Disconnect it here and connect again with a new setup token.', res.status);
    }
    if (res.status === 402) {
      throw new BankFeedError('unavailable', 'SimpleFIN says the subscription needs payment. Renew it in SimpleFIN Bridge (Billing) and sync again.', 402);
    }
    if (!res.ok) {
      throw new BankFeedError('unavailable', `SimpleFIN did not answer normally (HTTP ${res.status}). The portal will try again on the next daily sync.`, res.status);
    }

    let body;
    try { body = await res.json(); } catch {
      throw new BankFeedError('bad_response', 'SimpleFIN sent a response the portal could not read.', res.status);
    }
    return normalizeAccountSet(body);
  }
}
