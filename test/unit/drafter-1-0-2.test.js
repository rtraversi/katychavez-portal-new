// Drafter 1.0.2: the redesigned USCIS Forms tab.
//
// Edition badge and warning (D-11, D-12, D-16), the three downloads (D-5,
// D-15), autofill without clicking (RT-10), and Remove still refused for a
// form with a finalized copy.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';

const helpersMock = vi.hoisted(() => ({
  verifyAuth:      vi.fn(),
  makeAdminClient: vi.fn(),
  json: (status, body) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }),
}));
vi.mock('../../functions/api/_helpers.js', () => helpersMock);

const fillContextMock = vi.hoisted(() => ({ loadPackageTemplates: vi.fn(), seedMatterForms: vi.fn(async () => ({})) }));
vi.mock('../../functions/api/_fill-context.js', () => fillContextMock);

import { editionStatus, acceptedUntil, shortDate } from '../../functions/api/_form-edition-status.js';
import { parseEditionNotices } from '../../functions/api/_uscis-editions.js';
import { onRequest as download, downloadName } from '../../functions/api/form-filler-download.js';
import { onRequest as packageApi } from '../../functions/api/form-filler-package.js';
import { onRequest as matterForms } from '../../functions/api/form-filler-matter-forms.js';
import '../../js/form-filler-rows.js';

const Rows = globalThis.FormFillerRows;
const ON = '2026-10-23';

// ── Supabase stub ─────────────────────────────────────────────────────────────
// Records the columns each select asked for, and every write.
function makeAdmin(tables) {
  const writes = [];
  const selects = [];
  function build(table) {
    const state = { filters: {}, ins: {} };
    const rows = () => {
      let out = tables[table] || [];
      for (const [c, v] of Object.entries(state.filters)) out = out.filter(r => r[c] === v);
      for (const [c, vs] of Object.entries(state.ins)) out = out.filter(r => vs.includes(r[c]));
      return out;
    };
    const chain = {
      select: (cols) => { selects.push({ table, cols }); return chain; },
      eq:     (c, v) => { state.filters[c] = v; return chain; },
      in:     (c, v) => { state.ins[c] = v; return chain; },
      order:  () => chain,
      limit:  () => chain,
      insert: (payload) => { writes.push({ table, op: 'insert', payload }); return chain; },
      update: (payload) => { writes.push({ table, op: 'update', payload }); return chain; },
      upsert: (payload) => { writes.push({ table, op: 'upsert', payload }); return chain; },
      delete: () => { writes.push({ table, op: 'delete' }); return chain; },
      single:      async () => ({ data: rows()[0] || null, error: null }),
      maybeSingle: async () => ({ data: rows()[0] || null, error: null }),
      then: (resolve) => resolve({ data: rows(), error: null }),
    };
    return chain;
  }
  return { from: build, writes, selects };
}

beforeEach(() => {
  vi.clearAllMocks();
  helpersMock.verifyAuth.mockResolvedValue({ profile: { id: 'user-1' } });
});

// ── Edition badge and warning ────────────────────────────────────────────────

// A form_editions row after the checker's migration 2005 (edition_notices).
const row = (edition_date, upstream_edition, statements = [], unreadable = [], extra = {}) => ({
  form_number: 'I-485', edition_date, upstream_edition, check_status: 'stale',
  edition_notices: { statements, unreadable, text: '' }, ...extra,
});

describe('edition status (D-11, D-12)', () => {
  it('no row: "Edition unknown", amber, no line', () => {
    expect(editionStatus(null, ON)).toEqual({ tag: { label: 'Edition unknown', kind: 'warn' }, warning: null });
  });

  it('notices say not accepted: red badge and the red warning', () => {
    const r = row('01/20/25', '09/18/26', [
      { kind: 'reject', edition: '01/20/25', from: '2026-09-18', until: null },
      { kind: 'only', edition: '09/18/26', from: '2026-09-18', until: null },
    ]);
    expect(editionStatus(r, ON)).toEqual({
      tag: { label: 'Edition 01/20/25', kind: 'crit' },
      warning: { level: 'danger', text: 'WARNING THIS EDITION IS NO LONGER ACCEPTED BY USCIS' },
    });
  });

  it('reads the I-485 notice from uscis.gov the same way', () => {
    const html = '<p>Reject the 01/20/25 and 09/04/26 edition of Form I-485 if it is postmarked on or after Sept. 18, 2026; and Only accept the 09/18/26 edition of Form I-485 if it is postmarked on or after Sept. 18, 2026.</p>';
    const r = { form_number: 'I-485', edition_date: '01/20/25', upstream_edition: '09/18/26', check_status: 'stale', edition_notices: parseEditionNotices(html, 'I-485') };
    expect(editionStatus(r, ON).tag).toEqual({ label: 'Edition 01/20/25', kind: 'crit' });
  });

  it('accepted until a date: green badge, amber line with MM/DD/YY', () => {
    const r = row('04/01/24', '06/01/26', [{ kind: 'accept', edition: '04/01/24', from: null, until: '2026-12-31' }]);
    expect(editionStatus(r, ON)).toEqual({
      tag: { label: 'Edition 04/01/24', kind: 'ok' },
      warning: { level: 'warn', text: 'WARNING THIS EDITION WILL BE ACCEPTED UNTIL 12/31/26' },
    });
  });

  it('end date = the day before a reject of ours starts', () => {
    const r = row('04/01/24', '04/01/24', [{ kind: 'reject', edition: '04/01/24', from: '2026-11-15', until: null }]);
    expect(editionStatus(r, ON).warning.text).toBe('WARNING THIS EDITION WILL BE ACCEPTED UNTIL 11/14/26');
    expect(editionStatus(r, ON).tag.kind).toBe('ok');
  });

  it('end date = the day before an "only accept" of another edition starts', () => {
    const r = row('10/17/24', '08/24/26', [
      { kind: 'accept', edition: '10/17/24', from: null, until: null },
      { kind: 'only', edition: '08/24/26', from: '2026-11-01', until: null },
    ]);
    expect(editionStatus(r, ON).warning.text).toBe('WARNING THIS EDITION WILL BE ACCEPTED UNTIL 10/31/26');
  });

  it('an "only accept" that keeps ours does not end it', () => {
    const r = row('08/24/26', '08/24/26', [{ kind: 'only', edition: '08/24/26', from: '2026-11-01', until: null }]);
    expect(editionStatus(r, ON)).toEqual({ tag: { label: 'Edition 08/24/26', kind: 'ok' }, warning: null });
  });

  it('end date = the earliest of all three', () => {
    const statements = [
      { kind: 'accept', edition: '10/17/24', from: null, until: '2026-12-31' },
      { kind: 'reject', edition: '10/17/24', from: '2026-12-01', until: null },
      { kind: 'only', edition: '08/24/26', from: '2026-11-20', until: null },
    ];
    expect(acceptedUntil('10/17/24', statements, ON)).toBe('2026-11-19');
  });

  it('a grace period ends on its own day', () => {
    const r = row('10/17/24', '08/24/26', [{ kind: 'accept', edition: '10/17/24', from: null, until: '2026-10-23' }]);
    expect(editionStatus(r, '2026-10-23')).toEqual({
      tag: { label: 'Edition 10/17/24', kind: 'ok' },
      warning: { level: 'warn', text: 'WARNING THIS EDITION WILL BE ACCEPTED UNTIL 10/23/26' },
    });
    expect(editionStatus(r, '2026-10-24')).toEqual({
      tag: { label: 'Edition 10/17/24', kind: 'crit' },
      warning: { level: 'danger', text: 'WARNING THIS EDITION IS NO LONGER ACCEPTED BY USCIS' },
    });
  });

  it('current, no end: green, no line', () => {
    expect(editionStatus(row('09/17/18', '09/17/18'), ON)).toEqual({ tag: { label: 'Edition 09/17/18', kind: 'ok' }, warning: null });
  });

  it('accepted alongside a newer one, no end: green, no line', () => {
    const r = row('05/23/18', '09/17/18', [{ kind: 'accept', edition: '05/23/18', from: null, until: null }]);
    expect(editionStatus(r, ON)).toEqual({ tag: { label: 'Edition 05/23/18', kind: 'ok' }, warning: null });
  });

  it('notice unclear: grey, no line', () => {
    const r = row('01/20/25', '09/18/26', [], ['03/01/23']);
    expect(editionStatus(r, ON)).toEqual({ tag: { label: 'Edition 01/20/25', kind: 'mut' }, warning: null });
  });

  it('the badge only ever names our edition', () => {
    expect(editionStatus(row('1/20/2025', '09/18/26'), ON).tag.label).toBe('Edition 01/20/25');
  });

  it('shortDate', () => {
    expect(shortDate('2026-12-31')).toBe('12/31/26');
    expect(shortDate(null)).toBe(null);
  });
});

describe('edition status without edition_notices (D-16, production today)', () => {
  // No edition_notices key at all: the column does not exist before 2005.
  const old = (check_status) => ({ form_number: 'G-28', edition_date: '09/17/18', upstream_edition: '09/17/18', check_status });

  it('check_status current: green', () => {
    expect(editionStatus(old('current'), ON)).toEqual({ tag: { label: 'Edition 09/17/18', kind: 'ok' }, warning: null });
  });
  it('stale: amber, no line', () => {
    expect(editionStatus(old('stale'), ON)).toEqual({ tag: { label: 'Edition 09/17/18', kind: 'warn' }, warning: null });
  });
  it('error or unknown: grey', () => {
    expect(editionStatus(old('error'), ON).tag.kind).toBe('mut');
    expect(editionStatus(old('unknown'), ON).tag.kind).toBe('mut');
  });
  it('notices without an upstream edition also fall back', () => {
    const r = { ...old('stale'), upstream_edition: null, edition_notices: { statements: [{ kind: 'reject', edition: '09/17/18', from: null }] } };
    expect(editionStatus(r, ON)).toEqual({ tag: { label: 'Edition 09/17/18', kind: 'warn' }, warning: null });
  });
});

// ── Package API ──────────────────────────────────────────────────────────────

describe('/api/form-filler/package — editions and finalized copies', () => {
  // One copy each, as loadPackageTemplates returns them since 1.0.4.
  const copy = (t, row) => ({ ...t, row_id: row, row_key: row, fee_amount: null });
  const T1 = copy({ id: 't1', form_key: 'g-28', label: 'Form G-28', r2_key: 'tpl/g-28.pdf', active: true }, 'mf1');
  const T2 = copy({ id: 't2', form_key: 'i-485', label: 'Form I-485', r2_key: 'tpl/i-485.pdf', active: true }, 'mf2');
  const T3 = copy({ id: 't3', form_key: 'g-1450', label: 'Form G-1450', r2_key: null, active: true }, 'mf3');

  async function call(tables) {
    const admin = makeAdmin({ matters: [{ id: 'm1', case_type_id: null }], form_templates: [], ...tables });
    helpersMock.makeAdminClient.mockReturnValue(admin);
    fillContextMock.loadPackageTemplates.mockResolvedValue({ pkg: null, seeded: true, activeTemplates: [T1, T2, T3] });
    const res = await packageApi({ request: new Request('http://portal.test/api/form-filler/package?matter_id=m1'), env: {} });
    return { res, body: await res.json(), admin };
  }

  it("reads form_editions with select('*') and returns each form's row and status", async () => {
    const g28 = { form_number: 'G-28', edition_date: '09/17/18', upstream_edition: '09/17/18', check_status: 'current' };
    const { res, body, admin } = await call({ form_editions: [g28], generated_forms: [] });
    expect(res.status).toBe(200);
    expect(admin.selects).toContainEqual({ table: 'form_editions', cols: '*' });
    const [f1, f2] = body.forms;
    expect(f1.edition).toEqual(g28);
    expect(f1.edition_status.tag).toEqual({ label: 'Edition 09/17/18', kind: 'ok' });
    expect(f2.edition).toBe(null);
    expect(f2.edition_status.tag).toEqual({ label: 'Edition unknown', kind: 'warn' });
  });

  it('keeps an older finalized version reachable after a newer draft', async () => {
    const { body } = await call({
      generated_forms: [
        { id: 'g2', matter_id: 'm1', template_id: 't1', matter_form_id: 'mf1', status: 'draft', version_num: 2, r2_key: 'd2' },
        { id: 'g1', matter_id: 'm1', template_id: 't1', matter_form_id: 'mf1', status: 'finalized', version_num: 1, r2_key: 'd1', finalized_r2_key: 'f1' },
      ],
    });
    const f = body.forms[0];
    expect(f.generated_form_id).toBe('g2');
    expect(f.has_finalized).toBe(true);
    expect(f.finalized_form_id).toBe('g1');
    expect(body.forms[1].has_finalized).toBe(false);
    expect(body.forms[1].finalized_form_id).toBe(null);
  });
});

// ── Downloads ────────────────────────────────────────────────────────────────

async function fillableDraft() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  form.createTextField('name').addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
  form.getTextField('name').setText('Ejemplo');
  return doc.save();
}

function r2With(objects) {
  return {
    get: vi.fn(async (key) => objects[key] ? {
      body: new Blob([objects[key]]).stream(),
      arrayBuffer: async () => objects[key].buffer.slice(objects[key].byteOffset, objects[key].byteOffset + objects[key].byteLength),
    } : null),
    put: vi.fn(),
    delete: vi.fn(),
  };
}

describe('/api/form-filler/download (D-5, D-15)', () => {
  const ROW = {
    id: 'g1', r2_key: 'draft.pdf', finalized_r2_key: 'final.pdf', signed_r2_key: 'signed.pdf',
    file_name: 'Form G-28 (v3).pdf', status: 'draft',
    template: { form_key: 'g-28' }, matter: { client: { last_name: 'Ejemplo Vargas' } },
  };
  let admin, R2;

  beforeEach(async () => {
    admin = makeAdmin({ generated_forms: [{ ...ROW }] });
    helpersMock.makeAdminClient.mockReturnValue(admin);
    const draft = new Uint8Array(await fillableDraft());
    R2 = r2With({ 'draft.pdf': draft, 'final.pdf': draft, 'signed.pdf': draft });
  });

  const get = (qs) => download({ request: new Request(`http://portal.test/api/form-filler/download?${qs}`), env: { R2 } });
  const ATTACH = `attachment; filename="G-28 - EJEMPLO VARGAS.pdf"; filename*=UTF-8''G-28%20-%20EJEMPLO%20VARGAS.pdf`;

  it('Download: the editable draft as an attachment, named "G-28 - LASTNAME.pdf"', async () => {
    const res = await get('id=g1&dl=1');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe(ATTACH);
    expect(R2.get).toHaveBeenCalledWith('draft.pdf');
    const doc = await PDFDocument.load(await res.arrayBuffer());
    expect(doc.getForm().getFields()).toHaveLength(1);
  });

  it('Flatten and download: the same draft, flattened, same name', async () => {
    const res = await get('id=g1&dl=1&flatten=1');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe(ATTACH);
    expect(R2.get).toHaveBeenCalledWith('draft.pdf');
    const doc = await PDFDocument.load(await res.arrayBuffer());
    expect(doc.getForm().getFields()).toHaveLength(0);
  });

  it('Flatten and download stores nothing and does not finalize', async () => {
    await get('id=g1&dl=1&flatten=1');
    expect(R2.put).not.toHaveBeenCalled();
    expect(admin.writes).toEqual([]);
    const { data } = await admin.from('generated_forms').select('*').eq('id', 'g1').single();
    expect(data).toMatchObject({ status: 'draft', finalized_r2_key: 'final.pdf' });
  });

  it('Download finalized copy: the stored flattened PDF, as an attachment', async () => {
    const res = await get('id=g1&dl=1&final=1');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Disposition')).toBe(ATTACH);
    expect(R2.get).toHaveBeenCalledWith('final.pdf');
  });

  it('without dl=1 the file still opens inline under its stored name (Open signed)', async () => {
    const res = await get('id=g1&signed=1');
    expect(res.headers.get('Content-Disposition')).toMatch(/^inline; filename="Form G-28 \(v3\)\.pdf"/);
    expect(R2.get).toHaveBeenCalledWith('signed.pdf');
  });

  it('flatten applies to the draft only', async () => {
    expect((await get('id=g1&dl=1&flatten=1&final=1')).status).toBe(400);
  });

  it('downloadName falls back to the stored name without a form key', () => {
    expect(downloadName({ file_name: 'x.pdf' })).toBe('x.pdf');
    expect(downloadName({ file_name: 'x.pdf', template: { form_key: 'i-765' }, matter: { client: null } })).toBe('I-765.pdf');
  });

  it('the browser keeps the server name, any letter included', () => {
    expect(Rows.fileNameFromDisposition(ATTACH)).toBe('G-28 - EJEMPLO VARGAS.pdf');
    expect(Rows.fileNameFromDisposition(`attachment; filename="I-130 - NGUYN.pdf"; filename*=UTF-8''I-130%20-%20NGUY%E1%BB%84N.pdf`)).toBe('I-130 - NGUYỄN.pdf');
    expect(Rows.fileNameFromDisposition('attachment; filename="a.pdf"')).toBe('a.pdf');
    expect(Rows.fileNameFromDisposition(null)).toBe(null);
  });
});

// ── The rows ─────────────────────────────────────────────────────────────────

describe('autofill without clicking (RT-10)', () => {
  const forms = [
    { template_id: 'a', template_ready: true, generated_form_id: null },     // needs it
    { template_id: 'b', template_ready: true, generated_form_id: 'g-b' },    // already filled
    { template_id: 'c', template_ready: false, generated_form_id: null },    // no template
    { template_id: 'd', template_ready: true, generated_form_id: null },     // needs it, but busy
  ];

  it('generates only forms whose template is ready and that have no generated form', () => {
    expect(Rows.needsAutofill(forms)).toEqual(['a', 'd']);
  });
  it('skips forms already being filled', () => {
    expect(Rows.needsAutofill(forms, new Set(['d']))).toEqual(['a']);
  });
  it('nothing to do on a filled list', () => {
    expect(Rows.needsAutofill([forms[1], forms[2]])).toEqual([]);
    expect(Rows.needsAutofill(undefined)).toEqual([]);
  });
});

describe('the ⋯ menu (RT-11, D-15)', () => {
  const keys = (f) => Rows.menuItems(f).map(i => i.k);
  const base = { template_ready: true, generated_form_id: 'g1', has_signed: false, has_finalized: false, finalized_form_id: null };

  it('a filled form: Autofill, Flatten and download, divider, Reset, Remove', () => {
    expect(keys(base)).toEqual(['autofill', 'flatten', 'hr', 'reset', 'remove']);
    expect(Rows.menuItems(base).find(i => i.k === 'flatten').label).toBe('Flatten and download');
  });

  it('Download finalized copy only with a finalized copy; Open signed only with a signed one', () => {
    expect(keys({ ...base, has_finalized: true, finalized_form_id: 'g0', has_signed: true }))
      .toEqual(['autofill', 'flatten', 'finalized', 'signed', 'hr', 'reset', 'remove']);
  });

  it('a form without a template: just Remove, no divider', () => {
    expect(keys({ template_ready: false, generated_form_id: null })).toEqual(['remove']);
  });

  it('Remove is disabled, with today\'s tooltip, for a form with a finalized copy', () => {
    const remove = Rows.menuItems({ ...base, has_finalized: true, finalized_form_id: 'g0' }).find(i => i.k === 'remove');
    expect(remove).toMatchObject({ disabled: true, title: "Finalized forms can't be removed. Reset this form first if you really need to." });
    expect(Rows.menuItems(base).find(i => i.k === 'remove').disabled).toBeFalsy();
  });

  it("Reset's confirm, in Max's words (D-13)", () => {
    expect(Rows.resetPrompt({ form_key: 'g-28', label: 'Form G-28' }))
      .toBe('Reset G-28? Your edits are deleted and it autofills again from the client card.');
  });
});

describe('Remove is still refused for a form with a finalized copy', () => {
  it('the API answers 409 and deletes nothing', async () => {
    const admin = makeAdmin({
      matters: [{ id: 'm1', case_type_id: 'ct1' }],
      matter_forms: [{ id: 'mf1', matter_id: 'm1', template_id: 't1', sort_order: 10 }],
      form_templates: [{ id: 't1', form_key: 'g-28', label: 'Form G-28', r2_key: 'tpl/g-28.pdf', active: true }],
      generated_forms: [
        { id: 'g2', matter_id: 'm1', template_id: 't1', matter_form_id: 'mf1', status: 'draft', r2_key: 'd2' },
        { id: 'g1', matter_id: 'm1', template_id: 't1', matter_form_id: 'mf1', status: 'finalized', r2_key: 'd1', finalized_r2_key: 'f1' },
      ],
    });
    helpersMock.makeAdminClient.mockReturnValue(admin);
    const R2 = { delete: vi.fn() };
    const res = await matterForms({
      request: new Request('http://portal.test/api/form-filler/matter-forms', {
        method: 'DELETE', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ matter_id: 'm1', template_id: 't1' }),
      }),
      env: { R2 },
    });
    expect(res.status).toBe(409);
    expect(admin.writes.filter(w => w.op === 'delete')).toEqual([]);
    expect(R2.delete).not.toHaveBeenCalled();
  });
});
