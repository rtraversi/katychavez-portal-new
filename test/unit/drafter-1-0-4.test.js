// Drafter 1.0.4: two G-1450s on one case, each with its own amount (RT-9,
// RT-12, RT-13, D-19, D-20, D-21). Every action works on one matter_forms row,
// so the two copies never share files, versions or edits.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { createFormDb, createR2 } from '../support/fake-form-db.js';

const helpersMock = vi.hoisted(() => ({
  verifyAuth:      vi.fn(),
  makeAdminClient: vi.fn(),
  ssnDecrypt:      vi.fn(),
  json: (status, body) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }),
}));
vi.mock('../../functions/api/_helpers.js', () => helpersMock);

import { onRequest as generate } from '../../functions/api/form-filler-generate.js';
import { onRequest as fieldsApi } from '../../functions/api/form-filler-fields.js';
import { onRequest as resetApi } from '../../functions/api/form-filler-reset.js';
import { onRequest as packageApi } from '../../functions/api/form-filler-package.js';
import { onRequest as matterForms } from '../../functions/api/form-filler-matter-forms.js';
import { onRequest as rowFee } from '../../functions/api/form-filler-row-fee.js';
import { onRequest as download, downloadName } from '../../functions/api/form-filler-download.js';
import { onRequest as packageItems } from '../../functions/api/case-builder-package-items.js';
import { seedMatterForms, loadPackageTemplates } from '../../functions/api/_fill-context.js';
import { applyTransform, resolvePath } from '../../functions/api/_form-fill.js';
import { formFileName } from '../../functions/api/_form-file-name.js';
import { canRepeat, parseFeeAmount, REPEATABLE_FORMS } from '../../functions/api/_form-copies.js';
import migration1627 from '../../supabase/migrations/1627_matter_form_copies.sql?raw';
import migrationG1450 from '../../supabase/migrations/1600-g1450-fee-amount.sql?raw';
import validatorJs from '../../scripts/validate-field-map.js?raw';
import '../../js/form-filler-rows.js';

const Rows = globalThis.FormFillerRows;
const AMT = 'form1[0].#subform[0].AuthorizedPaymentAmt[0]';
const FAMILY = 'form1[0].#subform[0].FamilyName[0]';
const GIVEN = 'form1[0].#subform[0].GivenName[0]';

// A G-1450-shaped blank: the three boxes these tests read.
async function g1450Blank() {
  const doc = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  [FAMILY, GIVEN, AMT].forEach((n, i) => form.createTextField(n).addToPage(page, { x: 50, y: 700 - i * 30, width: 200, height: 20 }));
  return new Uint8Array(await doc.save());
}

const G1450 = {
  id: 'tpl-g1450', form_key: 'g-1450', label: 'Form G-1450', r2_key: 'form-templates/g-1450.pdf', active: true,
  field_map: {
    [FAMILY]: { type: 'text', source: 'client.last_name' },
    [GIVEN]:  { type: 'text', source: 'client.first_name' },
    [AMT]:    { type: 'text', source: 'form.fee_amount', transform: 'whole_dollars' },
  },
  firm_overrides: {},
};
const G28 = { id: 'tpl-g28', form_key: 'g-28', label: 'Form G-28', r2_key: 'form-templates/g-28.pdf', active: true, field_map: {}, firm_overrides: {} };

function daca(extra = {}) {
  return createFormDb({
    clients:         [{ id: 'c1', first_name: 'Mateo', last_name: 'Ejemplo' }],
    matters:         [{ id: 'm1', client_id: 'c1', case_type_id: 'ct-daca', assigned_attorney_id: null }],
    form_templates:  [G1450, G28],
    form_packages:   [{ id: 'pkg', case_type_id: 'ct-daca', name: 'DACA Renewal Package', active: true }],
    matter_forms: [
      { id: 'row-a', matter_id: 'm1', template_id: 'tpl-g1450', sort_order: 60, required: true, fee_amount: 520 },
      { id: 'row-b', matter_id: 'm1', template_id: 'tpl-g1450', sort_order: 61, required: true, fee_amount: 85 },
    ],
    form_field_edits: [],
    generated_forms: [],
    ...extra,
  });
}

const post = (path, body) => new Request(`http://portal.test${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const get = (path) => new Request(`http://portal.test${path}`);

async function textOf(r2, key, field) {
  const doc = await PDFDocument.load(r2.objects.get(key));
  return doc.getForm().getTextField(field).getText() ?? '';
}

let db, R2;
beforeEach(async () => {
  vi.clearAllMocks();
  helpersMock.verifyAuth.mockImplementation(async () => ({ profile: { id: 'u1' }, admin: db }));
  db = daca();
  helpersMock.makeAdminClient.mockImplementation(() => db);
  R2 = createR2({ 'form-templates/g-1450.pdf': await g1450Blank() });
});

// ── Two G-1450s, separate amounts, edits and files ───────────────────────────

describe('two G-1450s on one case', () => {
  it('each copy gets its own file, name and amount', async () => {
    const res = await generate({ request: post('/api/form-filler/generate', { matter_id: 'm1' }), env: { R2 } });
    expect(res.status).toBe(200);
    const gen = db.rows('generated_forms');
    expect(gen).toHaveLength(2);
    const a = gen.find(g => g.matter_form_id === 'row-a');
    const b = gen.find(g => g.matter_form_id === 'row-b');
    expect(a.r2_key).not.toBe(b.r2_key);
    expect(a.file_name).toBe('G-1450 $520 - EJEMPLO.pdf');
    expect(b.file_name).toBe('G-1450 $85 - EJEMPLO.pdf');
    expect([a.version_num, b.version_num]).toEqual([1, 1]);
    expect(await textOf(R2, a.r2_key, AMT)).toBe('520');
    expect(await textOf(R2, b.r2_key, AMT)).toBe('85');
  });

  it('an edit to one copy stays on that copy', async () => {
    const res = await fieldsApi({
      request: post('/api/form-filler/fields', { matter_id: 'm1', template_id: 'tpl-g1450', row_id: 'row-b', edits: [{ field_name: GIVEN, value: 'Segundo' }] }),
      env: {},
    });
    expect((await res.json()).saved).toBe(1);
    expect(db.rows('form_field_edits')).toMatchObject([{ matter_form_id: 'row-b', template_id: 'tpl-g1450', field_name: GIVEN, value: 'Segundo' }]);

    await generate({ request: post('/api/form-filler/generate', { matter_id: 'm1' }), env: { R2 } });
    const gen = db.rows('generated_forms');
    expect(await textOf(R2, gen.find(g => g.matter_form_id === 'row-a').r2_key, GIVEN)).toBe('Mateo');
    expect(await textOf(R2, gen.find(g => g.matter_form_id === 'row-b').r2_key, GIVEN)).toBe('Segundo');

    // The editor shows each copy its own edits and its own amount.
    const fa = await (await fieldsApi({ request: get('/api/form-filler/fields?matter_id=m1&template_id=tpl-g1450&row_id=row-a'), env: {} })).json();
    const fb = await (await fieldsApi({ request: get('/api/form-filler/fields?matter_id=m1&template_id=tpl-g1450&row_id=row-b'), env: {} })).json();
    expect(fa.fields.find(f => f.name === GIVEN).manual_value).toBe(null);
    expect(fb.fields.find(f => f.name === GIVEN).manual_value).toBe('Segundo');
    expect(fa.fields.find(f => f.name === AMT).autofill_value).toBe('520');
    expect(fb.fields.find(f => f.name === AMT).autofill_value).toBe('85');
  });

  it('Autofill and Reset act on one copy only', async () => {
    await generate({ request: post('/api/form-filler/generate', { matter_id: 'm1' }), env: { R2 } });
    await generate({ request: post('/api/form-filler/generate', { matter_id: 'm1', row_ids: ['row-a'] }), env: { R2 } });
    const versions = (row) => db.rows('generated_forms').filter(g => g.matter_form_id === row).map(g => g.version_num).sort();
    expect(versions('row-a')).toEqual([1, 2]);
    expect(versions('row-b')).toEqual([1]);

    db.rows('form_field_edits').push({ id: 'e1', matter_id: 'm1', template_id: 'tpl-g1450', matter_form_id: 'row-b', field_name: GIVEN, value: 'x' });
    const bKey = db.rows('generated_forms').find(g => g.matter_form_id === 'row-b').r2_key;
    const res = await resetApi({ request: post('/api/form-filler/reset', { matter_id: 'm1', row_ids: ['row-a'] }), env: { R2 } });
    expect((await res.json()).deleted).toBe(2);
    expect(versions('row-a')).toEqual([]);
    expect(versions('row-b')).toEqual([1]);
    expect(db.rows('form_field_edits')).toHaveLength(1);
    expect(R2.objects.has(bKey)).toBe(true);
  });

  it('Remove takes one copy, its drafts and edits, and leaves the other', async () => {
    await generate({ request: post('/api/form-filler/generate', { matter_id: 'm1' }), env: { R2 } });
    const req = new Request('http://portal.test/api/form-filler/matter-forms', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matter_id: 'm1', row_id: 'row-a' }),
    });
    expect((await matterForms({ request: req, env: { R2 } })).status).toBe(200);
    expect(db.rows('matter_forms').map(r => r.id)).toEqual(['row-b']);
    expect(db.rows('generated_forms').map(g => g.matter_form_id)).toEqual(['row-b']);
  });

  it('template_id alone is refused when the form is on the case twice', async () => {
    const req = new Request('http://portal.test/api/form-filler/matter-forms', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ matter_id: 'm1', template_id: 'tpl-g1450' }),
    });
    expect((await matterForms({ request: req, env: { R2 } })).status).toBe(400);
    expect(db.rows('matter_forms')).toHaveLength(2);
  });

  it('the package API lists both copies, each with its own amount and draft', async () => {
    await generate({ request: post('/api/form-filler/generate', { matter_id: 'm1', row_ids: ['row-b'] }), env: { R2 } });
    const body = await (await packageApi({ request: get('/api/form-filler/package?matter_id=m1'), env: {} })).json();
    expect(body.forms.map(f => [f.row_key, f.fee_amount, f.has_fee, !!f.generated_form_id])).toEqual([
      ['row-a', 520, true, false],
      ['row-b', 85, true, true],
    ]);
    // "+ Add form" still offers G-1450 with one already on the case; G-28 is not on it here.
    expect(body.available.map(a => a.form_key).sort()).toEqual(['g-1450', 'g-28']);
  });
});

// ── The amount (D-19, D-20) ──────────────────────────────────────────────────

describe('the amount', () => {
  it('saving stores whole dollars on that row only', async () => {
    const res = await rowFee({ request: post('/api/form-filler/row-fee', { matter_id: 'm1', row_id: 'row-b', fee_amount: '$1,234' }), env: {} });
    expect(await res.json()).toEqual({ ok: true, row_id: 'row-b', fee_amount: 1234 });
    expect(db.rows('matter_forms').map(r => r.fee_amount)).toEqual([520, 1234]);
  });

  it('empty clears it; cents and words are refused', async () => {
    await rowFee({ request: post('/api/form-filler/row-fee', { matter_id: 'm1', row_id: 'row-a', fee_amount: '' }), env: {} });
    expect(db.rows('matter_forms')[0].fee_amount).toBe(null);
    for (const bad of ['520.50', 'five', '-5', '12345678']) {
      const res = await rowFee({ request: post('/api/form-filler/row-fee', { matter_id: 'm1', row_id: 'row-b', fee_amount: bad }), env: {} });
      expect(res.status).toBe(400);
    }
    expect(db.rows('matter_forms')[1].fee_amount).toBe(85);
  });

  it('only a G-1450 carries one', async () => {
    db.rows('matter_forms').push({ id: 'row-g28', matter_id: 'm1', template_id: 'tpl-g28', sort_order: 20 });
    const res = await rowFee({ request: post('/api/form-filler/row-fee', { matter_id: 'm1', row_id: 'row-g28', fee_amount: '520' }), env: {} });
    expect(res.status).toBe(422);
  });

  it('parseFeeAmount', () => {
    expect(parseFeeAmount('520')).toEqual({ value: 520 });
    expect(parseFeeAmount(' $520.00 ')).toEqual({ value: 520 });
    expect(parseFeeAmount('1,234')).toEqual({ value: 1234 });
    expect(parseFeeAmount(null)).toEqual({ value: null });
    expect(parseFeeAmount('85.5').error).toMatch(/Whole dollars/);
  });
});

describe('filling AuthorizedPaymentAmt', () => {
  it('whole dollars, no "$", no cents', () => {
    expect(applyTransform(520, 'whole_dollars')).toBe('520');
    expect(applyTransform('1,234', 'whole_dollars')).toBe('1234');
    expect(applyTransform('$85.00', 'whole_dollars')).toBe('85');
    expect(applyTransform(null, 'whole_dollars')).toBe(null);
  });

  it('form.fee_amount reads the copy being filled', () => {
    expect(resolvePath('form.fee_amount', { form: { fee_amount: 520 } }, {})).toEqual({ value: 520 });
    expect(resolvePath('form.fee_amount', { form: { fee_amount: null } }, {})).toEqual({ value: null });
  });

  it('no amount: the box stays blank', async () => {
    db.rows('matter_forms')[0].fee_amount = null;
    await generate({ request: post('/api/form-filler/generate', { matter_id: 'm1', row_ids: ['row-a'] }), env: { R2 } });
    const a = db.rows('generated_forms')[0];
    expect(await textOf(R2, a.r2_key, AMT)).toBe('');
    expect(a.file_name).toBe('G-1450 - EJEMPLO.pdf');
  });

  it('the map amend and the validator know the new source', () => {
    expect(migrationG1450).toContain(`"${AMT}": { "type": "text", "source": "form.fee_amount", "transform": "whole_dollars" }`);
    expect(migrationG1450).toMatch(/SET field_map = field_map \|\| '/);
    expect(migrationG1450).toContain("WHERE form_key = 'g-1450';");
    expect(validatorJs).toMatch(/SOURCE_PREFIXES = \[[\s\S]*'form',[\s\S]*\];/);
  });
});

// ── File names (RT-12) ───────────────────────────────────────────────────────

describe('file names', () => {
  it('a G-1450 with an amount carries it; without, 1.0.1\'s rule', () => {
    expect(formFileName('g-1450', 'Ejemplo', 520)).toBe('G-1450 $520 - EJEMPLO.pdf');
    expect(formFileName('g-1450', 'Ejemplo', null)).toBe('G-1450 - EJEMPLO.pdf');
    expect(formFileName('g-1450', null, 85)).toBe('G-1450 $85.pdf');
  });

  it('every other form keeps 1.0.1\'s rule', () => {
    expect(formFileName('g-28', 'Ejemplo', 520)).toBe('G-28 - EJEMPLO.pdf');
    expect(formFileName('i-821d', 'Ejemplo Vargas')).toBe('I-821D - EJEMPLO VARGAS.pdf');
  });

  it('downloads use the copy\'s amount', async () => {
    await generate({ request: post('/api/form-filler/generate', { matter_id: 'm1' }), env: { R2 } });
    const b = db.rows('generated_forms').find(g => g.matter_form_id === 'row-b');
    const res = await download({ request: get(`/api/form-filler/download?id=${b.id}&dl=1`), env: { R2 } });
    expect(res.headers.get('Content-Disposition')).toMatch(/^attachment; filename="G-1450 \$85 - EJEMPLO\.pdf"/);
    expect(downloadName({ file_name: 'x.pdf', template: { form_key: 'g-1450' }, matter: { client: { last_name: 'Ejemplo' } }, copy: null })).toBe('G-1450 - EJEMPLO.pdf');
  });
});

// ── Seeding from a package (D-21) ────────────────────────────────────────────

describe('a new DACA case seeded from its package', () => {
  const ITEMS = [
    { id: 'pi-g28', package_id: 'pkg', template_id: 'tpl-g28', sort_order: 20, required: true },
    { id: 'pi-fee1', package_id: 'pkg', template_id: 'tpl-g1450', sort_order: 60, required: true },
    { id: 'pi-fee2', package_id: 'pkg', template_id: 'tpl-g1450', sort_order: 61, required: true },
  ];

  it('gets one row per package line: two G-1450s, both on "Set fee"', async () => {
    db = daca({ matter_forms: [], form_package_items: ITEMS });
    const before = await loadPackageTemplates(db, { id: 'm1', case_type_id: 'ct-daca' });
    expect(before.seeded).toBe(false);
    expect(before.activeTemplates.map(t => t.row_key)).toEqual(['item:pi-g28', 'item:pi-fee1', 'item:pi-fee2']);

    expect(await seedMatterForms(db, { id: 'm1', case_type_id: 'ct-daca' }, 'u1')).toEqual({ seeded: true, inserted: 3 });
    const rows = db.rows('matter_forms');
    expect(rows.map(r => [r.template_id, r.package_item_id, r.fee_amount ?? null])).toEqual([
      ['tpl-g28', 'pi-g28', null], ['tpl-g1450', 'pi-fee1', null], ['tpl-g1450', 'pi-fee2', null],
    ]);
    // A second call (a double-click) adds nothing.
    expect(await seedMatterForms(db, { id: 'm1', case_type_id: 'ct-daca' }, 'u1')).toEqual({ seeded: false, inserted: 0 });
    expect(db.rows('matter_forms')).toHaveLength(3);
    expect(Rows.feeLabel({ fee_amount: null })).toBe('Set fee');
    expect(Rows.feeLabel({ fee_amount: 520 })).toBe('$520');
  });

  it('a draft from before seeding is adopted by the first copy of its form', async () => {
    db = daca({
      matter_forms: [], form_package_items: ITEMS,
      generated_forms:  [{ id: 'old', matter_id: 'm1', template_id: 'tpl-g1450', matter_form_id: null, version_num: 1, r2_key: 'k/old' }],
      form_field_edits: [{ id: 'oe', matter_id: 'm1', template_id: 'tpl-g1450', matter_form_id: null, field_name: GIVEN, value: 'Viejo' }],
    });
    await seedMatterForms(db, { id: 'm1', case_type_id: 'ct-daca' }, 'u1');
    const first = db.rows('matter_forms').find(r => r.package_item_id === 'pi-fee1').id;
    expect(db.rows('generated_forms')[0].matter_form_id).toBe(first);
    expect(db.rows('form_field_edits')[0].matter_form_id).toBe(first);
  });
});

// ── Which forms can repeat ───────────────────────────────────────────────────

describe('only G-1450 may repeat', () => {
  const add = (template_id) => matterForms({ request: post('/api/form-filler/matter-forms', { matter_id: 'm1', template_id }), env: { R2 } });

  it('the allowlist', () => {
    expect([...REPEATABLE_FORMS]).toEqual(['g-1450']);
    expect(canRepeat('G-1450')).toBe(true);
    expect(canRepeat('g-28')).toBe(false);
  });

  it('"+ Add form" adds a third G-1450 but refuses a second G-28', async () => {
    expect((await add('tpl-g1450')).status).toBe(200);
    expect(db.rows('matter_forms').filter(r => r.template_id === 'tpl-g1450')).toHaveLength(3);
    expect((await add('tpl-g28')).status).toBe(200);
    const again = await add('tpl-g28');
    expect(again.status).toBe(409);
    expect(db.rows('matter_forms').filter(r => r.template_id === 'tpl-g28')).toHaveLength(1);
  });

  it('Case Builder: a package may list G-1450 twice, not G-28', async () => {
    db.rows('form_package_items').push({ id: 'x', package_id: 'pkg', template_id: 'tpl-g28' });
    const save = (ids) => packageItems({ request: post('/api/case-builder/package-items', { package_id: 'pkg', items: ids.map(template_id => ({ template_id })) }), env: {} });
    expect((await save(['tpl-g28', 'tpl-g1450', 'tpl-g1450'])).status).toBe(200);
    expect(db.rows('form_package_items').map(i => i.template_id)).toEqual(['tpl-g28', 'tpl-g1450', 'tpl-g1450']);
    expect((await save(['tpl-g28', 'tpl-g28'])).status).toBe(400);
  });

  it('the ⋯ menu offers Set fee / Change fee on a G-1450 copy only', () => {
    const keys = (f) => Rows.menuItems(f).map(i => i.k);
    const base = { template_ready: true, generated_form_id: 'g1', row_id: 'row-a', has_fee: true };
    expect(Rows.menuItems({ ...base, fee_amount: null }).find(i => i.k === 'fee').label).toBe('Set fee');
    expect(Rows.menuItems({ ...base, fee_amount: 520 }).find(i => i.k === 'fee').label).toBe('Change fee');
    expect(keys({ ...base, has_fee: false })).not.toContain('fee');
    expect(Rows.scopeFor([{ row_id: 'row-a', template_id: 't' }])).toEqual({ row_ids: ['row-a'] });
    expect(Rows.scopeFor([{ row_id: null, template_id: 't' }, { row_id: null, template_id: 't' }])).toEqual({ template_ids: ['t'] });
  });
});

// ── Migration 1627 ───────────────────────────────────────────────────────────

describe('migration 1627', () => {
  const code = migration1627.replace(/--[^\n]*/g, '');

  it('says Rob applies it before deploying', () => {
    expect(migration1627).toMatch(/ROB APPLIES THIS BEFORE DEPLOYING DRAFTER 1\.0\.4/);
  });

  it('backfills drafts and edits to the case\'s single row for that form, only where unset', () => {
    const backfills = code.match(/WITH first_row AS \([\s\S]*?\)\s*UPDATE public\.(\w+)[\s\S]*?;/g) || [];
    expect(backfills).toHaveLength(2);
    for (const [sql, table] of [[backfills[0], 'generated_forms'], [backfills[1], 'form_field_edits']]) {
      expect(sql).toContain(`UPDATE public.${table}`);
      expect(sql).toMatch(/SELECT DISTINCT ON \(matter_id, template_id\) id, matter_id, template_id\s+FROM public\.matter_forms\s+ORDER BY matter_id, template_id, sort_order, created_at, id/);
      expect(sql).toMatch(/WHERE \w\.matter_form_id IS NULL AND \w\.matter_id = f\.matter_id AND \w\.template_id = f\.template_id/);
    }
    // Backfill runs before the per-copy UNIQUEs replace the old ones.
    expect(code.indexOf('UPDATE public.form_field_edits')).toBeLessThan(code.indexOf('generated_forms_matter_form_version_key'));
  });

  it('drops the one-per-case rules and adds the per-copy ones', () => {
    expect(code).toContain("drop_unique('public.matter_forms', ARRAY['matter_id', 'template_id'])");
    expect(code).toContain("drop_unique('public.generated_forms', ARRAY['matter_id', 'template_id', 'version_num'])");
    expect(code).toContain("drop_unique('public.form_field_edits', ARRAY['matter_id', 'template_id', 'field_name'])");
    expect(code).toContain("drop_unique('public.form_package_items', ARRAY['package_id', 'template_id'])");
    expect(code).toMatch(/UNIQUE \(matter_form_id, version_num\)/);
    expect(code).toMatch(/UNIQUE \(matter_form_id, field_name\)/);
    expect(code).toMatch(/ON public\.matter_forms \(matter_id, package_item_id\)/);
  });

  it('is idempotent', () => {
    expect(code).not.toMatch(/ADD COLUMN (?!IF NOT EXISTS)/);
    expect(code).not.toMatch(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/);
    expect(code).toMatch(/IF NOT EXISTS \(SELECT 1 FROM pg_constraint WHERE conname = 'generated_forms_matter_form_version_key'\)/);
    // The DACA package's second G-1450 is added only while it lists one.
    expect(code).toMatch(/WHERE \(SELECT count\(\*\) FROM public\.form_package_items x\s+WHERE x\.package_id = i\.package_id AND x\.template_id = i\.template_id\) = 1;/);
  });
});
