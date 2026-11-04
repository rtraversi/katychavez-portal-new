// A matter can carry extra case types (matters.additional_case_type_ids, 2301).
// A case type used ONLY there is still in use: hard delete must refuse it.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
  json: (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}));
vi.mock('../../functions/api/_helpers.js', () => helpersMock);

import { onRequest } from '../../functions/api/case-builder-case-type.js';

function adminWith({ primary = 0, appts = 0, extra = 0 }) {
  const deleted = [];
  return {
    deleted,
    from(table) {
      const q = {
        _kind: null,
        select() { return this; },
        eq(col) { this._kind = col === 'case_type_id' ? table : 'other'; return this; },
        contains(col) { this._kind = 'extra'; return this; },
        delete() { return { eq: async (_c, id) => { deleted.push(id); return { error: null }; } }; },
        then(res) {
          const count = this._kind === 'extra' ? extra : this._kind === 'matters' ? primary : this._kind === 'appointments' ? appts : 0;
          return Promise.resolve({ count, error: null }).then(res);
        },
      };
      return q;
    },
  };
}

const del = (id) => new Request('http://portal.test/api/case-builder/case-type', {
  method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }),
});

describe('case type delete guard', () => {
  beforeEach(() => vi.clearAllMocks());

  it('refuses a case type used only as an "also includes" case type', async () => {
    const admin = adminWith({ extra: 2 });
    helpersMock.verifyAuth.mockResolvedValue({ admin });
    const res = await onRequest({ request: del('ct-1'), env: {} });
    expect(res.status).toBe(409);
    expect((await res.json()).error).toMatch(/2 matters/);
    expect(admin.deleted).toEqual([]);
  });

  it('still deletes a case type nobody uses', async () => {
    const admin = adminWith({});
    helpersMock.verifyAuth.mockResolvedValue({ admin });
    const res = await onRequest({ request: del('ct-1'), env: {} });
    expect(res.status).toBe(200);
    expect(admin.deleted).toEqual(['ct-1']);
  });
});
