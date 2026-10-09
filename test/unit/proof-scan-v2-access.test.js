// Proof Scan v2: every registered v2 route refuses anon and Client logins.
//
// Added when v2 was ported onto the production branch. v1.2's route tests
// (proof-scan-api / proof-scan-history) asserted these same boundaries for
// v1.2's endpoints, which never shipped and were retired. This guard walks the
// real _worker.js routes table, so a v2 route added later is covered without
// anyone remembering to list it here.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({ verifyAuth: vi.fn(), makeAdminClient: vi.fn() }));
vi.mock('../../functions/api/_helpers.js', async (importOriginal) => ({
  ...(await importOriginal()),
  verifyAuth: helpersMock.verifyAuth,
  makeAdminClient: helpersMock.makeAdminClient,
}));

import { routes } from '../../_worker.js';
import { seededDb, apiRequest, ENV, CLIENT, NO_TOKEN } from '../support/proof-scan-v2-harness.js';

const V2_ROUTES = Object.entries(routes).filter(([path]) => path.startsWith('/api/proof-scan-v2-'));
const METHODS = ['GET', 'POST', 'PATCH', 'DELETE'];

let db;
beforeEach(() => {
  vi.clearAllMocks();
  db = seededDb();
  helpersMock.makeAdminClient.mockReturnValue(db);
  globalThis.fetch = vi.fn(async () => { throw new Error('unexpected network call'); });
});

// Every method against every route. A 405 is fine (nothing served); the route
// must reach its auth check on at least one method, and never answer 2xx.
async function sweep() {
  const out = [];
  for (const [path, handler] of V2_ROUTES) {
    for (const method of METHODS) {
      const body = method === 'GET' ? undefined : { case_id: crypto.randomUUID() };
      const query = method === 'GET' ? { id: crypto.randomUUID() } : undefined;
      const res = await handler({ request: apiRequest(path, { method, body, query }), env: ENV, ctx: { waitUntil() {} } });
      out.push({ path, method, status: res.status });
    }
  }
  return out;
}

describe('Proof Scan v2 route access', () => {
  it('finds the v2 routes in the worker table', () => {
    expect(V2_ROUTES.length).toBeGreaterThanOrEqual(11);
  });

  it('refuses a request with no login on every route and method', async () => {
    helpersMock.verifyAuth.mockResolvedValue(NO_TOKEN);
    const results = await sweep();
    for (const r of results) expect([401, 405], `${r.method} ${r.path}`).toContain(r.status);
    for (const [path] of V2_ROUTES) {
      expect(results.some((r) => r.path === path && r.status === 401), `${path} never checked auth`).toBe(true);
    }
  });

  it('refuses a Client-role login on every route and method, and writes nothing', async () => {
    helpersMock.verifyAuth.mockResolvedValue(CLIENT);
    const results = await sweep();
    for (const r of results) expect([403, 405], `${r.method} ${r.path}`).toContain(r.status);
    for (const [path] of V2_ROUTES) {
      expect(results.some((r) => r.path === path && r.status === 403), `${path} never refused the client`).toBe(true);
    }
    expect(db.log.filter((e) => e.op !== 'select')).toEqual([]);
  });
});
