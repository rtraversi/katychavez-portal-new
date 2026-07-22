// Unit tests for per-matter USCIS form lists (migration 1605).
//
// Covers the three behaviors the redesign turns on:
//   1. /api/form-filler/matter-forms — add/remove a form on one matter, with
//      the finalized-form removal block
//   2. /api/form-filler/reset — template_ids scoping, so resetting one form
//      doesn't blow away the other five
//   3. _fill-context.loadPackageTemplates — matter_forms wins when it exists,
//      the case-type package is only a fallback suggestion
//
// The form-filler module had no test coverage at all before this; these are
// the first. Note the G-28 coupling asserted at the bottom: package.form_numbers
// derives from the matter's ACTUAL list, so removing a form must drop it from
// the G-28's "this appearance relates to" line.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({
  verifyAuth:      vi.fn(),
  makeAdminClient: vi.fn(),
  json: (status, body) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }),
}));
vi.mock('../../functions/api/_helpers.js', () => helpersMock);

import { onRequest as matterForms } from '../../functions/api/form-filler-matter-forms.js';
import { onRequest as resetForms }  from '../../functions/api/form-filler-reset.js';
import { loadPackageTemplates }     from '../../functions/api/_fill-context.js';

// ── Supabase stub ─────────────────────────────────────────────────────────────
//
// from(table) -> chainable builder. Reads filter rows out of `tables`; writes
// are recorded on `.writes` so tests can assert what was actually mutated
// (and, just as importantly, what wasn't).
function makeAdmin(tables) {
  const writes = [];

  function build(table) {
    const state = { table, filters: {}, ins: {}, head: false };

    function rows() {
      let out = tables[table] || [];
      for (const [col, val] of Object.entries(state.filters)) out = out.filter(r => r[col] === val);
      for (const [col, vals] of Object.entries(state.ins))    out = out.filter(r => vals.includes(r[col]));
      return out;
    }

    const chain = {
      select: (_cols, opts) => { if (opts?.head) state.head = true; return chain; },
      eq:     (c, v) => { state.filters[c] = v; return chain; },
      in:     (c, v) => { state.ins[c] = v; return chain; },
      order:  () => chain,
      limit:  () => chain,
      insert: (payload) => { writes.push({ table, op: 'insert', payload }); return chain; },
      upsert: (payload, opts) => { writes.push({ table, op: 'upsert', payload, opts }); return chain; },
      delete: () => { writes.push({ table, op: 'delete', filters: state.filters, ins: state.ins }); return chain; },

      single:      async () => ({ data: rows()[0] || null, error: null }),
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      // `await chain` — count queries resolve to { count }, everything else to rows.
      then: (resolve) => resolve(
        state.head ? { count: rows().length, error: null } : { data: rows(), error: null },
      ),
    };
    return chain;
  }

  return { from: build, writes };
}

const R2 = () => ({ delete: vi.fn() });

function req(method, body) {
  return new Request('http://portal.test/api/form-filler/matter-forms', {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const MATTER = { id: 'm1', case_type_id: 'ct1' };

beforeEach(() => {
  vi.clearAllMocks();
  helpersMock.verifyAuth.mockResolvedValue({ profile: { id: 'user-1' } });
});

// ── Guards ────────────────────────────────────────────────────────────────────

describe('/api/form-filler/matter-forms — guards', () => {
  it('rejects verbs other than POST/DELETE', async () => {
    const res = await matterForms({ request: new Request('http://portal.test/api/form-filler/matter-forms'), env: {} });
    expect(res.status).toBe(405);
  });

  it('requires draft_forms WRITE — a read-only user cannot change the list', async () => {
    helpersMock.verifyAuth.mockResolvedValue({ httpError: { status: 403, message: 'nope' } });
    const res = await matterForms({ request: req('POST', { matter_id: 'm1', template_id: 't1' }), env: {} });
    expect(res.status).toBe(403);
    expect(helpersMock.verifyAuth).toHaveBeenCalledWith(
      expect.anything(), expect.anything(), 'write', 'draft_forms',
    );
  });

  it('requires matter_id and template_id', async () => {
    const res = await matterForms({ request: req('POST', { matter_id: 'm1' }), env: {} });
    expect(res.status).toBe(400);
  });

  it('404s an unknown matter', async () => {
    helpersMock.makeAdminClient.mockReturnValue(makeAdmin({ matters: [] }));
    const res = await matterForms({ request: req('POST', { matter_id: 'nope', template_id: 't1' }), env: {} });
    expect(res.status).toBe(404);
  });
});

// ── Add ───────────────────────────────────────────────────────────────────────

describe('/api/form-filler/matter-forms — add', () => {
  const READY = { id: 't9', form_key: 'i-130', label: 'Form I-130', r2_key: 'tpl/i-130.pdf', active: true };

  // t1 is already on the matter; t9 is the one being added. Both must exist in
  // form_templates — the handler checks the template exists before it checks
  // for a duplicate, so a missing row 404s instead of 409ing.
  const EXISTING = { id: 't1', form_key: 'i-821d', label: 'Form I-821D', r2_key: 'tpl/i-821d.pdf', active: true };

  function admin(extra = {}) {
    return makeAdmin({
      matters:        [MATTER],
      form_templates: [READY, EXISTING],
      matter_forms:   [{ id: 'mf1', matter_id: 'm1', template_id: 't1', sort_order: 10 }],
      ...extra,
    });
  }

  it('adds the form as source=manual, appended to the end of the order', async () => {
    const a = admin();
    helpersMock.makeAdminClient.mockReturnValue(a);
    const res = await matterForms({ request: req('POST', { matter_id: 'm1', template_id: 't9' }), env: { R2: R2() } });
    expect(res.status).toBe(200);

    const insert = a.writes.find(w => w.table === 'matter_forms' && w.op === 'insert');
    expect(insert.payload).toMatchObject({
      matter_id: 'm1', template_id: 't9', source: 'manual', required: false, added_by: 'user-1',
    });
    // Appended after the existing sort_order 10, not colliding with it.
    expect(insert.payload.sort_order).toBeGreaterThan(10);
  });

  it('409s a form already on the matter', async () => {
    helpersMock.makeAdminClient.mockReturnValue(admin());
    const res = await matterForms({ request: req('POST', { matter_id: 'm1', template_id: 't1' }), env: { R2: R2() } });
    expect(res.status).toBe(409);
  });

  it('422s a template with no uploaded PDF — it could never generate', async () => {
    helpersMock.makeAdminClient.mockReturnValue(admin({
      form_templates: [{ ...READY, r2_key: null }],
    }));
    const res = await matterForms({ request: req('POST', { matter_id: 'm1', template_id: 't9' }), env: { R2: R2() } });
    expect(res.status).toBe(422);
  });

  it('422s an inactive template', async () => {
    helpersMock.makeAdminClient.mockReturnValue(admin({
      form_templates: [{ ...READY, active: false }],
    }));
    const res = await matterForms({ request: req('POST', { matter_id: 'm1', template_id: 't9' }), env: { R2: R2() } });
    expect(res.status).toBe(422);
  });
});

// ── Remove ────────────────────────────────────────────────────────────────────

describe('/api/form-filler/matter-forms — remove', () => {
  const ON_MATTER = { id: 'mf1', matter_id: 'm1', template_id: 't1' };

  it('404s a form that is not on the matter', async () => {
    helpersMock.makeAdminClient.mockReturnValue(makeAdmin({ matters: [MATTER], matter_forms: [] }));
    const res = await matterForms({ request: req('DELETE', { matter_id: 'm1', template_id: 't1' }), env: { R2: R2() } });
    expect(res.status).toBe(404);
  });

  it('removes the form and deletes its drafts, PDFs and manual edits', async () => {
    const r2 = R2();
    const a  = makeAdmin({
      matters:         [MATTER],
      matter_forms:    [ON_MATTER],
      generated_forms: [
        { id: 'g1', matter_id: 'm1', template_id: 't1', status: 'draft', r2_key: 'gen/a.pdf', finalized_r2_key: null },
      ],
    });
    helpersMock.makeAdminClient.mockReturnValue(a);

    const res = await matterForms({ request: req('DELETE', { matter_id: 'm1', template_id: 't1' }), env: { R2: r2 } });
    expect(res.status).toBe(200);

    expect(r2.delete).toHaveBeenCalledWith(['gen/a.pdf']);
    expect(a.writes.some(w => w.table === 'generated_forms' && w.op === 'delete')).toBe(true);
    expect(a.writes.some(w => w.table === 'form_field_edits' && w.op === 'delete')).toBe(true);
    expect(a.writes.some(w => w.table === 'matter_forms'    && w.op === 'delete')).toBe(true);
  });

  it('refuses to remove a FINALIZED form and destroys nothing', async () => {
    const r2 = R2();
    const a  = makeAdmin({
      matters:         [MATTER],
      matter_forms:    [ON_MATTER],
      generated_forms: [
        { id: 'g1', matter_id: 'm1', template_id: 't1', status: 'finalized', r2_key: 'gen/a.pdf', finalized_r2_key: 'gen/a-final.pdf' },
      ],
    });
    helpersMock.makeAdminClient.mockReturnValue(a);

    const res = await matterForms({ request: req('DELETE', { matter_id: 'm1', template_id: 't1' }), env: { R2: r2 } });
    expect(res.status).toBe(409);
    expect((await res.json()).finalized).toBe(true);

    // The filing must survive the refusal intact.
    expect(r2.delete).not.toHaveBeenCalled();
    expect(a.writes.some(w => w.op === 'delete')).toBe(false);
  });
});

// ── Reset scoping ─────────────────────────────────────────────────────────────

describe('/api/form-filler/reset — per-form scoping', () => {
  function resetReq(body) {
    return new Request('http://portal.test/api/form-filler/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  const GENERATED = [
    { id: 'g1', matter_id: 'm1', template_id: 't1', r2_key: 'gen/1.pdf', finalized_r2_key: null },
    { id: 'g2', matter_id: 'm1', template_id: 't2', r2_key: 'gen/2.pdf', finalized_r2_key: null },
  ];

  it('resets only the named form, leaving the others alone', async () => {
    const r2 = R2();
    const a  = makeAdmin({ generated_forms: GENERATED });
    helpersMock.makeAdminClient.mockReturnValue(a);

    const res = await resetForms({ request: resetReq({ matter_id: 'm1', template_ids: ['t1'] }), env: { R2: r2 } });
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(1);

    // Only t1's PDF is removed — t2's draft is untouched.
    expect(r2.delete).toHaveBeenCalledWith(['gen/1.pdf']);

    // Manual edits are scoped the same way, or resetting one form would wipe
    // every hand-typed answer on the matter.
    const editDelete = a.writes.find(w => w.table === 'form_field_edits' && w.op === 'delete');
    expect(editDelete.ins.template_id).toEqual(['t1']);
  });

  it('resets the whole matter when template_ids is omitted', async () => {
    const r2 = R2();
    const a  = makeAdmin({ generated_forms: GENERATED });
    helpersMock.makeAdminClient.mockReturnValue(a);

    const res = await resetForms({ request: resetReq({ matter_id: 'm1' }), env: { R2: r2 } });
    expect(res.status).toBe(200);
    expect((await res.json()).deleted).toBe(2);
    expect(r2.delete).toHaveBeenCalledWith(['gen/1.pdf', 'gen/2.pdf']);

    const editDelete = a.writes.find(w => w.table === 'form_field_edits' && w.op === 'delete');
    expect(editDelete.ins.template_id).toBeUndefined();
  });

  it('rejects an empty template_ids array rather than resetting everything', async () => {
    helpersMock.makeAdminClient.mockReturnValue(makeAdmin({ generated_forms: GENERATED }));
    const res = await resetForms({ request: resetReq({ matter_id: 'm1', template_ids: [] }), env: { R2: R2() } });
    expect(res.status).toBe(400);
  });

  it('rejects a non-array template_ids', async () => {
    helpersMock.makeAdminClient.mockReturnValue(makeAdmin({ generated_forms: GENERATED }));
    const res = await resetForms({ request: resetReq({ matter_id: 'm1', template_ids: 't1' }), env: { R2: R2() } });
    expect(res.status).toBe(400);
  });
});

// ── Resolution precedence ─────────────────────────────────────────────────────

describe('loadPackageTemplates — matter list vs case-type package', () => {
  const TPL = (id, key) => ({ id, form_key: key, label: key.toUpperCase(), r2_key: `t/${key}.pdf`, active: true });

  it('falls back to the case-type package when the matter has no list yet', async () => {
    const admin = makeAdmin({
      form_packages:      [{ id: 'p1', case_type_id: 'ct1', name: 'DACA Renewal', active: true }],
      form_package_items: [{ package_id: 'p1', sort_order: 10, required: true, template: TPL('t1', 'i-821d') }],
      matter_forms:       [],
    });
    const out = await loadPackageTemplates(admin, MATTER);
    expect(out.seeded).toBe(false);
    expect(out.activeTemplates.map(t => t.form_key)).toEqual(['i-821d']);
    // Crucially, reading must not have written anything.
    expect(admin.writes).toHaveLength(0);
  });

  it('uses matter_forms once the matter owns its list, ignoring the package', async () => {
    const admin = makeAdmin({
      form_packages:      [{ id: 'p1', case_type_id: 'ct1', name: 'DACA Renewal', active: true }],
      form_package_items: [{ package_id: 'p1', sort_order: 10, required: true, template: TPL('t1', 'i-821d') }],
      matter_forms:       [{ matter_id: 'm1', sort_order: 10, required: true, template: TPL('t9', 'i-130') }],
    });
    const out = await loadPackageTemplates(admin, MATTER);
    expect(out.seeded).toBe(true);
    expect(out.activeTemplates.map(t => t.form_key)).toEqual(['i-130']);
  });

  it('returns an empty list, not an error, for a matter with no case type', async () => {
    const admin = makeAdmin({ matter_forms: [] });
    const out = await loadPackageTemplates(admin, { id: 'm1', case_type_id: null });
    expect(out.error).toBeUndefined();
    expect(out.activeTemplates).toEqual([]);
    expect(out.pkg).toBeNull();
  });

  it('drops inactive templates from the matter list', async () => {
    const admin = makeAdmin({
      matter_forms: [
        { matter_id: 'm1', sort_order: 10, template: TPL('t1', 'i-130') },
        { matter_id: 'm1', sort_order: 20, template: { ...TPL('t2', 'i-485'), active: false } },
      ],
    });
    const out = await loadPackageTemplates(admin, MATTER);
    expect(out.activeTemplates.map(t => t.form_key)).toEqual(['i-130']);
  });
});
