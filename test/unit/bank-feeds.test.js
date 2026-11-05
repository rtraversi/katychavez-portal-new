// Unit tests for Bank Accounts (bank feeds): the SimpleFIN adapter, credential
// encryption, the sync window, and storing a sync through a fake Supabase client.
//
// Fixture data mirrors SimpleFIN's public demo account (beta-bridge.simplefin.org),
// not a real bank.

import { describe, it, expect } from 'vitest';
import {
  SimpleFinAdapter, BankFeedError, decodeSetupToken, splitAccessUrl, clampWindow,
  normalizeAccountSet, decimalOrNull, isAllowedHost, MAX_WINDOW_DAYS,
} from '../../functions/api/_adapters/bank-feed/simplefin.js';
import { getBankFeedAdapter } from '../../functions/api/_adapters/bank-feed/index.js';
import {
  encryptSecret, decryptSecret, isEncryptionConfigured, syncWindow, manualSyncWaitSeconds,
  syncConnection, splitWindow, mergeAccountSets, INITIAL_DAYS, OVERLAP_DAYS,
} from '../../functions/api/_bank-feeds.js';

const KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const ENV = { BANK_FEED_ENCRYPTION_KEY: KEY };
const DAY = 86400;

const b64 = (s) => btoa(s);
const CLAIM_URL = 'https://beta-bridge.simplefin.org/simplefin/claim/DEMO-TEST';
const ACCESS_URL = 'https://demo-user:demo-pass@beta-bridge.simplefin.org/simplefin';

const DEMO_SET = {
  errors: [],
  accounts: [
    {
      id: 'Demo Checking', name: 'SimpleFIN Checking', currency: 'USD',
      balance: '25218.83', 'available-balance': '25218.83', 'balance-date': 1793923200,
      org: { name: 'SimpleFIN Demo', domain: 'beta-bridge.simplefin.org' },
      transactions: [
        { id: '1791427464', posted: 1791427464, amount: '-45.58', description: 'Fishing bait', payee: "John's Fishin Shack", memo: 'JOHNS FISHIN SHACK BAIT', transacted_at: 1791427464 },
        { id: 'p1', posted: 0, amount: '-1.00', description: 'Pending thing', pending: true },
        { id: 'bad', posted: 1791427464, amount: 'n/a', description: 'Unreadable amount' },
      ],
    },
    {
      // Same transaction id as in Checking: SimpleFIN ids are only unique per account.
      id: 'Demo Savings', name: 'SimpleFIN Savings', currency: 'USD',
      balance: '114825.51', 'balance-date': 1793923200,
      org: { name: 'SimpleFIN Demo' },
      transactions: [{ id: '1791427464', posted: 1791427464, amount: '-35.50', description: 'Fishing bait' }],
    },
  ],
};

const jsonRes = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

// ── Setup token + access URL ────────────────────────────────────────────────

describe('decodeSetupToken', () => {
  it('decodes a SimpleFIN token to its claim URL', () => {
    expect(decodeSetupToken(b64(CLAIM_URL), {})).toBe(CLAIM_URL);
  });

  it('tolerates whitespace and line breaks from copy-paste', () => {
    const t = b64(CLAIM_URL);
    expect(decodeSetupToken(`  ${t.slice(0, 10)}\n${t.slice(10)}  `, {})).toBe(CLAIM_URL);
  });

  it.each([
    ['empty', ''],
    ['not base64', '%%%not-a-token%%%'],
    ['not a URL', b64('hello world')],
    ['plain http', b64('http://bridge.simplefin.org/simplefin/claim/x')],
    ['another host', b64('https://evil.example.com/simplefin/claim/x')],
    ['look-alike host', b64('https://simplefin.org.evil.example.com/claim')],
    ['internal address', b64('https://169.254.169.254/latest/meta-data')],
  ])('rejects %s', (_label, token) => {
    expect(() => decodeSetupToken(token, {})).toThrow(BankFeedError);
    try { decodeSetupToken(token, {}); } catch (e) { expect(e.kind).toBe('invalid_token'); }
  });

  it('accepts an extra host when the deployment allows it', () => {
    const env = { BANK_FEED_SIMPLEFIN_HOSTS: 'simplefin.org, sfin.example-bank.com' };
    expect(decodeSetupToken(b64('https://sfin.example-bank.com/claim/1'), env)).toBe('https://sfin.example-bank.com/claim/1');
    expect(isAllowedHost('bridge.simplefin.org', env)).toBe(true);
  });
});

describe('splitAccessUrl', () => {
  it('moves the credentials out of the URL into a Basic header', () => {
    const { base, authorization } = splitAccessUrl(ACCESS_URL, {});
    expect(base).toBe('https://beta-bridge.simplefin.org/simplefin');
    expect(base).not.toContain('demo-pass');
    expect(authorization).toBe('Basic ' + btoa('demo-user:demo-pass'));
  });

  it('refuses an access URL without credentials or off the allowlist', () => {
    expect(() => splitAccessUrl('https://beta-bridge.simplefin.org/simplefin', {})).toThrow(BankFeedError);
    expect(() => splitAccessUrl('https://u:p@evil.example.com/simplefin', {})).toThrow(BankFeedError);
  });
});

describe('clampWindow', () => {
  it(`never asks for more than ${MAX_WINDOW_DAYS} days`, () => {
    const end = 1_800_000_000;
    expect(clampWindow(end - 400 * DAY, end)).toEqual({ start: end - MAX_WINDOW_DAYS * DAY, end });
    expect(clampWindow(end - 10 * DAY, end)).toEqual({ start: end - 10 * DAY, end });
  });
});

// ── Normalization ───────────────────────────────────────────────────────────

describe('normalizeAccountSet', () => {
  const set = normalizeAccountSet(DEMO_SET);

  it('maps accounts, keeping money as exact decimal strings', () => {
    expect(set.accounts).toHaveLength(2);
    expect(set.accounts[0]).toMatchObject({
      providerAccountId: 'Demo Checking', name: 'SimpleFIN Checking', institution: 'SimpleFIN Demo',
      currency: 'USD', balance: '25218.83', availableBalance: '25218.83',
      balanceDate: new Date(1793923200 * 1000).toISOString(),
    });
  });

  it('falls back to balance when available-balance is omitted', () => {
    expect(set.accounts[1].availableBalance).toBe('114825.51');
  });

  it('drops pending transactions and ones with an unreadable amount', () => {
    expect(set.accounts[0].transactions.map(t => t.providerTxnId)).toEqual(['1791427464']);
    expect(set.accounts[0].transactions[0]).toMatchObject({ amount: '-45.58', payee: "John's Fishin Shack" });
  });

  it('reads the newer errlist/connections shape', () => {
    const v2 = normalizeAccountSet({
      errlist: [{ code: 'con.auth', msg: 'Your bank needs you to sign in again.' }],
      connections: [{ conn_id: 'c1', name: 'Example Credit Union' }],
      accounts: [{ id: 'a1', name: 'Checking', conn_id: 'c1', currency: 'USD', balance: '10.00', 'balance-date': 1793923200 }],
    });
    expect(v2.warnings).toEqual(['Your bank needs you to sign in again.']);
    expect(v2.accounts[0].institution).toBe('Example Credit Union');
    expect(v2.accounts[0].transactions).toEqual([]);
  });

  it('copes with an empty or malformed body', () => {
    expect(normalizeAccountSet({})).toEqual({ accounts: [], warnings: [] });
    expect(normalizeAccountSet(null)).toEqual({ accounts: [], warnings: [] });
  });

  it('decimalOrNull accepts only plain decimals', () => {
    expect(decimalOrNull(' -12.30 ')).toBe('-12.30');
    expect(decimalOrNull('1e5')).toBeNull();
    expect(decimalOrNull('')).toBeNull();
  });
});

// ── Adapter over a fake fetch ───────────────────────────────────────────────

function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init = {}) => { calls.push({ url: String(url), init }); return handler(String(url), init); };
  fn.calls = calls;
  return fn;
}

describe('SimpleFinAdapter.claim', () => {
  it('POSTs to the claim URL and returns the access URL', async () => {
    const f = fakeFetch(() => new Response(ACCESS_URL + '\n', { status: 200 }));
    const a = new SimpleFinAdapter({}, f);
    expect(await a.claim(b64(CLAIM_URL))).toBe(ACCESS_URL);
    expect(f.calls[0]).toMatchObject({ url: CLAIM_URL });
    expect(f.calls[0].init.method).toBe('POST');
    expect(f.calls[0].init.redirect).toBe('manual');
  });

  it('explains a token that was already used', async () => {
    const a = new SimpleFinAdapter({}, fakeFetch(() => new Response('Forbidden', { status: 403 })));
    await expect(a.claim(b64(CLAIM_URL))).rejects.toMatchObject({ kind: 'already_claimed' });
  });

  it('never calls out for a token pointing off the allowlist', async () => {
    const f = fakeFetch(() => new Response('', { status: 200 }));
    await expect(new SimpleFinAdapter({}, f).claim(b64('https://evil.example.com/x'))).rejects.toMatchObject({ kind: 'invalid_token' });
    expect(f.calls).toHaveLength(0);
  });

  it('rejects a claim answer that is not a usable access URL', async () => {
    const a = new SimpleFinAdapter({}, fakeFetch(() => new Response('https://evil.example.com/x', { status: 200 })));
    await expect(a.claim(b64(CLAIM_URL))).rejects.toMatchObject({ kind: 'bad_response' });
  });
});

describe('SimpleFinAdapter.fetchAccounts', () => {
  it('sends credentials as a header, never in the URL, with a clamped window', async () => {
    const f = fakeFetch(() => jsonRes(200, DEMO_SET));
    const end = 1_800_000_000;
    const set = await new SimpleFinAdapter({}, f).fetchAccounts(ACCESS_URL, { start: end - 365 * DAY, end });
    expect(set.accounts).toHaveLength(2);
    const { url, init } = f.calls[0];
    expect(url).toBe(`https://beta-bridge.simplefin.org/simplefin/accounts?start-date=${end - MAX_WINDOW_DAYS * DAY}&end-date=${end}`);
    expect(url).not.toContain('demo-pass');
    expect(init.headers.Authorization).toBe('Basic ' + btoa('demo-user:demo-pass'));
  });

  it.each([[403, 'revoked'], [401, 'revoked'], [402, 'unavailable'], [500, 'unavailable']])(
    'maps HTTP %i to %s', async (status, kind) => {
      const a = new SimpleFinAdapter({}, fakeFetch(() => new Response('x', { status })));
      await expect(a.fetchAccounts(ACCESS_URL, { start: 0, end: 1_800_000_000 })).rejects.toMatchObject({ kind, status });
    });

  it('reports a network failure as unavailable', async () => {
    const a = new SimpleFinAdapter({}, async () => { throw new TypeError('fetch failed'); });
    await expect(a.fetchAccounts(ACCESS_URL, { start: 0, end: 1_800_000_000 })).rejects.toMatchObject({ kind: 'unavailable' });
  });
});

describe('getBankFeedAdapter', () => {
  it('returns SimpleFIN and refuses unknown providers', () => {
    expect(getBankFeedAdapter('simplefin', {}).provider).toBe('simplefin');
    expect(() => getBankFeedAdapter('plaid', {})).toThrow();
  });
});

// ── Encryption + timing ─────────────────────────────────────────────────────

describe('credential encryption', () => {
  it('round-trips and never stores the plaintext', () => {
    const enc = encryptSecret(ACCESS_URL, ENV);
    expect(enc).not.toContain('demo-pass');
    expect(enc.split(':')).toHaveLength(3);
    expect(decryptSecret(enc, ENV)).toBe(ACCESS_URL);
  });

  it('falls back to SSN_ENCRYPTION_KEY', () => {
    const env = { SSN_ENCRYPTION_KEY: KEY };
    expect(isEncryptionConfigured(env)).toBe(true);
    expect(decryptSecret(encryptSecret('x', env), ENV)).toBe('x');
  });

  it('refuses to run without a key, and fails on tampering', () => {
    expect(isEncryptionConfigured({})).toBe(false);
    expect(() => encryptSecret('x', {})).toThrow();
    const enc = encryptSecret('secret', ENV);
    const [iv, tag, ct] = enc.split(':');
    const flipped = `${iv}:${tag}:${(ct[0] === 'a' ? 'b' : 'a')}${ct.slice(1)}`;
    expect(() => decryptSecret(flipped, ENV)).toThrow();
  });
});

describe('syncWindow / manualSyncWaitSeconds', () => {
  const now = new Date('2026-11-05T12:00:00Z');
  const end = Math.floor(now.getTime() / 1000);

  it(`first sync reaches back ${INITIAL_DAYS} days`, () => {
    expect(syncWindow({}, now)).toEqual({ start: end - INITIAL_DAYS * DAY, end });
  });

  it(`later syncs overlap ${OVERLAP_DAYS} days`, () => {
    const last = new Date('2026-11-04T12:00:00Z');
    expect(syncWindow({ last_synced_at: last.toISOString() }, now))
      .toEqual({ start: Math.floor(last.getTime() / 1000) - OVERLAP_DAYS * DAY, end });
  });

  it('throttles manual syncs for 10 minutes', () => {
    expect(manualSyncWaitSeconds({}, now)).toBe(0);
    expect(manualSyncWaitSeconds({ last_attempt_at: new Date(now - 60_000).toISOString() }, now)).toBe(540);
    expect(manualSyncWaitSeconds({ last_attempt_at: new Date(now - 11 * 60_000).toISOString() }, now)).toBe(0);
  });
});

// ── syncConnection through a fake Supabase client ───────────────────────────

// Records every query as { table, steps: [[method, ...args]] } and answers each one
// from `respond(op)` when it is awaited.
function fakeAdmin(respond) {
  const ops = [];
  return {
    ops,
    from(table) {
      const op = { table, steps: [] };
      const builder = new Proxy({}, {
        get(_t, prop) {
          if (prop === 'then') {
            ops.push(op);
            const res = respond(op) || { data: null, error: null };
            return (ok, bad) => Promise.resolve(res).then(ok, bad);
          }
          return (...args) => { op.steps.push([prop, ...args]); return builder; };
        },
      });
      return builder;
    },
  };
}
const has = (op, method) => op.steps.find(s => s[0] === method);

describe('syncConnection', () => {
  const conn = { id: '11111111-1111-4111-8111-111111111111', provider: 'simplefin', last_synced_at: null };
  const now = new Date('2026-11-05T12:00:00Z');

  function adminFor(secretEnc) {
    return fakeAdmin((op) => {
      if (op.table === 'bank_connection_secrets') return { data: secretEnc ? { secret_enc: secretEnc } : null, error: null };
      if (op.table === 'bank_accounts' && has(op, 'upsert')) {
        return { data: has(op, 'upsert')[1].map((r, i) => ({ id: `acct-${i}`, provider_account_id: r.provider_account_id })), error: null };
      }
      return { data: null, error: null };
    });
  }

  it('stores accounts and transactions and marks the connection active', async () => {
    const admin = adminFor(encryptSecret(ACCESS_URL, ENV));
    const r = await syncConnection(admin, ENV, conn, { now, fetchFn: async () => jsonRes(200, DEMO_SET) });
    expect(r).toMatchObject({ ok: true, accounts: 2, transactions: 2, warning: null });

    const acctUpsert = admin.ops.find(o => o.table === 'bank_accounts' && has(o, 'upsert'));
    expect(has(acctUpsert, 'upsert')[2]).toEqual({ onConflict: 'connection_id,provider_account_id' });

    const txnUpsert = admin.ops.find(o => o.table === 'bank_transactions' && has(o, 'upsert'));
    const rows = has(txnUpsert, 'upsert')[1];
    // The shared provider id lands on two different accounts.
    expect(rows.map(r => [r.account_id, r.provider_txn_id])).toEqual([['acct-0', '1791427464'], ['acct-1', '1791427464']]);
    expect(has(txnUpsert, 'upsert')[2]).toEqual({ onConflict: 'account_id,provider_txn_id' });

    // Clean response → accounts no longer reported get present=false.
    expect(admin.ops.some(o => o.table === 'bank_accounts' && has(o, 'update') && has(o, 'not'))).toBe(true);

    const connUpdate = admin.ops.find(o => o.table === 'bank_connections' && has(o, 'update'));
    expect(has(connUpdate, 'update')[1]).toEqual({
      status: 'active', last_attempt_at: now.toISOString(), last_synced_at: now.toISOString(), last_error: null,
    });
  });

  it('keeps data but records the warning, and does not retire accounts, when the bank is struggling', async () => {
    const admin = adminFor(encryptSecret(ACCESS_URL, ENV));
    const withWarning = { ...DEMO_SET, errors: ['Your bank needs you to sign in again.'] };
    const r = await syncConnection(admin, ENV, conn, { now, fetchFn: async () => jsonRes(200, withWarning) });
    expect(r).toMatchObject({ ok: true, warning: 'Your bank needs you to sign in again.' });
    expect(admin.ops.some(o => o.table === 'bank_accounts' && has(o, 'not'))).toBe(false);
  });

  it('marks the connection revoked when SimpleFIN refuses the credential', async () => {
    const admin = adminFor(encryptSecret(ACCESS_URL, ENV));
    const r = await syncConnection(admin, ENV, conn, { now, fetchFn: async () => new Response('', { status: 403 }) });
    expect(r).toMatchObject({ ok: false, kind: 'revoked' });
    const upd = admin.ops.find(o => o.table === 'bank_connections' && has(o, 'update'));
    expect(has(upd, 'update')[1]).toMatchObject({ status: 'revoked', last_attempt_at: now.toISOString() });
    expect(admin.ops.some(o => o.table === 'bank_accounts')).toBe(false);
  });

  it('keeps the connection active on a temporary outage', async () => {
    const admin = adminFor(encryptSecret(ACCESS_URL, ENV));
    const r = await syncConnection(admin, ENV, conn, { now, fetchFn: async () => new Response('', { status: 503 }) });
    expect(r).toMatchObject({ ok: false, kind: 'unavailable' });
    const upd = admin.ops.find(o => o.table === 'bank_connections' && has(o, 'update'));
    expect(has(upd, 'update')[1].status).toBeUndefined();
  });

  it('flags a connection with no stored credential', async () => {
    const admin = adminFor(null);
    const r = await syncConnection(admin, ENV, conn, { now, fetchFn: async () => { throw new Error('should not fetch'); } });
    expect(r).toMatchObject({ ok: false, kind: 'revoked' });
  });
});

describe('splitWindow / mergeAccountSets', () => {
  const end = 1_800_000_000;

  it('splits a long range into provider-sized windows, oldest first', () => {
    const w = splitWindow({ start: end - 90 * DAY, end }, MAX_WINDOW_DAYS);
    expect(w).toEqual([
      { start: end - 90 * DAY, end: end - 45 * DAY },
      { start: end - 45 * DAY, end },
    ]);
    expect(w.every(x => x.end - x.start <= MAX_WINDOW_DAYS * DAY)).toBe(true);
    expect(splitWindow({ start: end - 3 * DAY, end }, MAX_WINDOW_DAYS)).toEqual([{ start: end - 3 * DAY, end }]);
  });

  it('takes balances from the newest window and de-duplicates transactions', () => {
    const older = normalizeAccountSet(DEMO_SET);
    const newer = normalizeAccountSet({
      errors: ['Bank is slow today.'],
      accounts: [{ ...DEMO_SET.accounts[0], balance: '1.00', transactions: [
        { id: '1791427464', posted: 1791427464, amount: '-45.58', description: 'Fishing bait (revised)' },
        { id: 'new-1', posted: 1791500000, amount: '200.00', description: 'Deposit' },
      ] }],
    });
    const m = mergeAccountSets([older, newer]);
    const checking = m.accounts.find(a => a.providerAccountId === 'Demo Checking');
    expect(checking.balance).toBe('1.00');
    expect(checking.transactions.map(t => [t.providerTxnId, t.description])).toEqual([
      ['1791427464', 'Fishing bait (revised)'], ['new-1', 'Deposit'],
    ]);
    // An account only the older window reported is kept.
    expect(m.accounts.map(a => a.providerAccountId).sort()).toEqual(['Demo Checking', 'Demo Savings']);
    expect(m.warnings).toEqual(['Bank is slow today.']);
  });
});

describe('syncConnection windows', () => {
  it('first sync asks for 90 days in two requests under the provider cap', async () => {
    const urls = [];
    const admin = fakeAdmin((op) => {
      if (op.table === 'bank_connection_secrets') return { data: { secret_enc: encryptSecret(ACCESS_URL, ENV) }, error: null };
      if (op.table === 'bank_accounts' && has(op, 'upsert')) {
        return { data: has(op, 'upsert')[1].map((r, i) => ({ id: `acct-${i}`, provider_account_id: r.provider_account_id })), error: null };
      }
      return { data: null, error: null };
    });
    const now = new Date('2026-11-05T12:00:00Z');
    const r = await syncConnection(admin, ENV, { id: 'c', provider: 'simplefin', last_synced_at: null }, {
      now, fetchFn: async (url) => { urls.push(url); return jsonRes(200, DEMO_SET); },
    });
    expect(r).toMatchObject({ ok: true, transactions: 2 });
    expect(urls).toHaveLength(2);
    for (const u of urls) {
      const q = new URL(u).searchParams;
      expect(Number(q.get('end-date')) - Number(q.get('start-date'))).toBeLessThanOrEqual(MAX_WINDOW_DAYS * DAY);
    }
  });
});
