// Drafter 1.0.3: capitals (D-18), the immigration "More details" fold (D-17),
// pick-one boxes (RT-15), and Case Builder's "+ Add forms" picker (F-1).
import { describe, it, expect, beforeAll } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { applyFieldMap, cleanForBox, isCapitalsColumn } from '../../functions/api/_form-fill.js';
import '../../js/contact-format.js';
import '../../js/case-fold.js';
import '../../js/pick-one.js';
import portalHtml from '../../portal.html?raw';
import clientsJs from '../../pages/clients/clients.js?raw';
import detailJs from '../../pages/clients/detail/detail.js?raw';
import draftFormsJs from '../../pages/draft-forms/draft-forms.js?raw';
import validatorJs from '../../scripts/validate-field-map.js?raw';

const { ContactFormat: CF, CaseFold, PickOne } = globalThis;

async function formWith(names) {
  const doc  = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  names.forEach((n, i) => form.createTextField(n).addToPage(page, { x: 50, y: 700 - i * 30, width: 200, height: 20 }));
  return form;
}

// ── Capitals (D-18) ──────────────────────────────────────────────────────────

describe('capitals on the forms', () => {
  it('last names, from every record that has one', () => {
    expect(cleanForBox('client.last_name', 'Ejemplo Vargas')).toBe('EJEMPLO VARGAS');
    expect(cleanForBox('petitioner.last_name', 'Nguyễn')).toBe('NGUYỄN');
    expect(cleanForBox('joint_sponsor.last_name', 'de la Cruz')).toBe('DE LA CRUZ');
    expect(cleanForBox('immigration.family.0.last_name', 'Ejemplo')).toBe('EJEMPLO');
    expect(cleanForBox('attorney.last_name', 'Chavez')).toBe('CHAVEZ');
    expect(cleanForBox('client.mother_last_name', 'Ruiz')).toBe('RUIZ');
  });

  it('countries: any column whose name contains "country"', () => {
    expect(cleanForBox('immigration.country_of_birth', 'Mexico')).toBe('MEXICO');
    expect(cleanForBox('immigration.country_of_citizenship', 'El Salvador')).toBe('EL SALVADOR');
    expect(cleanForBox('immigration.family.1.country_of_birth', 'Honduras')).toBe('HONDURAS');
    expect(cleanForBox('client.country', 'Guatemala')).toBe('GUATEMALA');
  });

  it('leaves first names and every other column alone', () => {
    expect(cleanForBox('client.first_name', 'Lucía')).toBe('Lucía');
    expect(cleanForBox('client.middle_name', 'María')).toBe('María');
    expect(cleanForBox('client.former_maiden_name', 'Ruiz')).toBe('Ruiz');
    expect(cleanForBox('client.city', 'Raleigh')).toBe('Raleigh');
    expect(cleanForBox('client.place_of_birth', 'Puebla, Mexico')).toBe('Puebla, Mexico');
    expect(cleanForBox('literal:Mexico', 'Mexico')).toBe('Mexico');
    expect(isCapitalsColumn('last_name_suffix')).toBe(false);
    expect(isCapitalsColumn('lastname')).toBe(false);
  });

  it('is what applyFieldMap writes into the box', async () => {
    const form = await formWith(['family', 'given', 'cob']);
    applyFieldMap(form, {
      family: { type: 'text', source: 'client.last_name' },
      given:  { type: 'text', source: 'client.first_name' },
      cob:    { type: 'text', source: 'immigration.country_of_birth' },
    }, { client: { last_name: 'Ejemplo', first_name: 'Lucía' }, immigration: { country_of_birth: 'Mexico' } }, {});
    expect(form.getTextField('family').getText()).toBe('EJEMPLO');
    expect(form.getTextField('given').getText()).toBe('Lucía');
    expect(form.getTextField('cob').getText()).toBe('MEXICO');
  });
});

describe('capitals on the card', () => {
  it('a last name saves in capitals, trimmed; empty saves as null', () => {
    expect(CF.upperName('  ejemplo vargas ')).toBe('EJEMPLO VARGAS');
    expect(CF.upperName('nguyễn')).toBe('NGUYỄN');
    expect(CF.upperName('   ')).toBe(null);
    expect(CF.upperName(null)).toBe(null);
  });

  it('turns to capitals when the input loses focus; other inputs are left alone', () => {
    const handlers = {};
    const root = { dataset: {}, addEventListener: (type, fn) => { handlers[type] = fn; } };
    CF.wire(root);
    const last  = { dataset: { fmt: 'upper' }, value: 'ejemplo' };
    const first = { dataset: {}, value: 'lucía' };
    handlers.focusout({ target: last });
    handlers.focusout({ target: first });
    expect(last.value).toBe('EJEMPLO');
    expect(first.value).toBe('lucía');
  });

  it('the new-client form marks the last name and saves it through upperName', () => {
    expect(clientsJs).toMatch(/id="client-last-name" name="last_name"[^>]*data-fmt="upper"/);
    expect(clientsJs).toContain("last_name:              ContactFormat.upperName(f.elements['last_name'].value)");
    expect(clientsJs).toMatch(/first_name:\s+f\.elements\['first_name'\]\.value\.trim\(\)/);
  });

  it('the card does the same for the client, petitioner, joint sponsor and family members', () => {
    // Client info, the petitioner / joint sponsor modal, the immigration family member modal.
    expect(detailJs).toContain(`inp('last_name','Last name',c.last_name,'text','required data-fmt="upper"')`);
    expect(detailJs).toContain(`inp('last_name','Last name',op.last_name||'','text', capsLast ? 'data-fmt="upper"' : '')`);
    expect(detailJs).toContain('const capsLast = isJointSponsor || isImmMatter();');
    expect(detailJs).toContain('name="last_name" data-fmt="upper"');
    expect((detailJs.match(/ContactFormat\.upperName\(fd\.get\('last_name'\)\)/g) || []).length).toBe(3);
    expect(detailJs).toContain("ContactFormat.wire(document.getElementById('imm-member-form'));");
  });
});

// ── The immigration fold (D-17) ──────────────────────────────────────────────

// Just enough DOM for CaseFold: elements, children, and simple selectors
// (tag, .class, [attr], [attr="v"], comma lists).
function el(tag, attrs = {}, children = []) {
  const node = {
    tagName: tag.toUpperCase(), attrs: { ...attrs }, children: [], parentNode: null, hidden: false, open: false, textContent: '',
    get className() { return this.attrs.class || ''; }, set className(v) { this.attrs.class = v; },
    setAttribute(k, v) { this.attrs[k] = String(v); }, getAttribute(k) { return this.attrs[k] ?? null; },
    appendChild(c) { return this.insertBefore(c, null); },
    insertBefore(c, ref) {
      if (c.parentNode) c.parentNode.children.splice(c.parentNode.children.indexOf(c), 1);
      const i = ref ? this.children.indexOf(ref) : -1;
      if (i === -1) this.children.push(c); else this.children.splice(i, 0, c);
      c.parentNode = this; c.ownerDocument = this.ownerDocument; return c;
    },
    get nextSibling() { const p = this.parentNode; return p ? p.children[p.children.indexOf(this) + 1] || null : null; },
    matches(sel) {
      return sel.split(',').map(s => s.trim()).some((s) => {
        const m = s.match(/^([a-z]+)?(?:\.([\w-]+))?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/);
        if (!m) throw new Error(`selector ${s}`);
        const [, t, cls, attr, val] = m;
        if (t && this.tagName !== t.toUpperCase()) return false;
        if (cls && !this.className.split(/\s+/).includes(cls)) return false;
        if (attr && !(attr in this.attrs)) return false;
        if (attr && val !== undefined && this.attrs[attr] !== val) return false;
        return true;
      });
    },
    querySelectorAll(sel) { const out = []; const walk = (n) => n.children.forEach((c) => { if (c.matches(sel)) out.push(c); walk(c); }); walk(this); return out; },
    querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
    closest(sel) { let n = this; while (n && n.matches) { if (n.matches(sel)) return n; n = n.parentNode; } return null; },
  };
  children.forEach((c) => node.appendChild(c));
  return node;
}

function newClientForm() {
  const doc = { createElement: (t) => el(t) };
  const field = (name, tag = 'input') => el('div', { class: 'field' }, [el(tag, { name })]);
  const form = el('form', { id: 'client-form' });
  form.ownerDocument = doc;
  const tree = [
    el('div', { class: 'field-row' }, [field('practice_area_id', 'select'), field('case_type_id', 'select')]),
    el('div', { class: 'field-row' }, [field('case_number'), field('court_county')]),
    el('div', { class: 'field-row' }, [field('judge_name'), field('date_filed')]),
    el('div', { class: 'field-row' }, [field('assigned_attorney_id', 'select'), field('billing_type', 'select')]),
    el('p', { id: 'compliance-divider' }),
    field('conflict_check_notes', 'textarea'),
    field('is_dv_confidential'),
    field('notes', 'textarea'),
  ];
  tree.forEach((n) => form.appendChild(n));
  return form;
}

const names = (nodes) => nodes.map((n) => n.querySelector('[name]')?.getAttribute('name'));

describe('immigration "More details" fold', () => {
  it('folds only for Immigration', () => {
    expect(CaseFold.isFolded('immigration')).toBe(true);
    for (const key of ['family_law', 'criminal', 'personal_injury', 'estate_planning', '', null, undefined]) {
      expect(CaseFold.isFolded(key)).toBe(false);
    }
  });

  it('folds the seven fields, in order, into a closed "More details"', () => {
    const form = newClientForm();
    const box = CaseFold.apply(form, true, { anchor: form.querySelector('[id="compliance-divider"]') });
    expect(box.tagName).toBe('DETAILS');
    expect(box.querySelector('summary').textContent).toBe('More details');
    expect(box.open).toBe(false);
    expect(box.hidden).toBe(false);
    expect(names(box.querySelector('.dk-formfold-body').children)).toEqual(CaseFold.FIELDS);
    // Still in the form, so still saved.
    for (const n of CaseFold.FIELDS) expect(form.querySelector(`[name="${n}"]`)).not.toBe(null);
    // Rows left empty are hidden; the attorney keeps its row.
    const rows = form.querySelectorAll('.field-row');
    expect(rows.map((r) => r.hidden)).toEqual([false, true, true, false]);
    // The fold sits where the caller asked: before the Compliance divider.
    expect(form.children[form.children.indexOf(box) + 1].getAttribute('id')).toBe('compliance-divider');
  });

  it('other practice areas look as today: nothing folded, no fold shown', () => {
    const form = newClientForm();
    const before = names(form.querySelectorAll('.field'));
    const box = CaseFold.apply(form, false);
    expect(box.hidden).toBe(true);
    expect(names(form.querySelectorAll('.field'))).toEqual(before);
    expect(form.querySelectorAll('.field-row').every((r) => !r.hidden)).toBe(true);
  });

  it('changing the practice area moves them back to where they were, and in again', () => {
    const form = newClientForm();
    const before = names(form.querySelectorAll('.field'));
    const box = CaseFold.apply(form, true);
    box.open = true;
    CaseFold.apply(form, false);
    expect(names(form.querySelectorAll('.field'))).toEqual(before);
    expect(box.hidden).toBe(true);
    expect(form.querySelectorAll('.field-row').every((r) => !r.hidden)).toBe(true);
    CaseFold.apply(form, true);
    expect(box.hidden).toBe(false);
    expect(box.open).toBe(false);   // folds again closed
    expect(names(box.querySelector('.dk-formfold-body').children)).toEqual(CaseFold.FIELDS);
  });

  it('is wired into the new-client form and both client card forms', () => {
    expect(portalHtml).toContain('<script src="js/case-fold.js"></script>');
    expect(clientsJs).toContain('foldCaseFields(e.target.value);');
    expect(clientsJs).toContain('foldCaseFields(paId);');
    expect(detailJs).toContain("names: ['case_number', 'court_county', 'judge_name', 'date_filed', 'billing_type'],");
    expect(detailJs).toContain("CaseFold.apply(fieldsEl, CaseFold.isFolded(matterPracticeAreaKey()), { names: ['conflict_check_notes', 'is_dv_confidential'] });");
  });
});

// ── Pick-one boxes (RT-15) ───────────────────────────────────────────────────

// The I-765's Part 1 as the normalized PDF has it (checked on the uscis.gov
// file in the Drafter Lab): three boxes, values 1, 2 and 3.
const P1 = 'form1[0].Page1[0].Part1_Checkbox';
const I765_PART1 = [0, 1, 2].map((i) => ({ name: `${P1}[${i}]`, exportValue: String(i + 1) }));
const UNIT = 'form1[0].Page2[0].Pt2Line5_Unit';
const I765_UNIT = [['STE', 0], ['FLR', 1], ['APT', 2]].map(([v, i]) => ({ name: `${UNIT}[${i}]`, exportValue: ` ${v} ` }));

describe('pick-one groups', () => {
  it('same name apart from [n], different values: one group (I-765 Part 1)', () => {
    const groups = PickOne.pickOneGroups(I765_PART1);
    expect([...groups.keys()]).toEqual([P1]);
    expect(groups.get(P1).map((b) => b.exportValue)).toEqual(['1', '2', '3']);
  });

  it('same name, the SAME value: the same answer repeated, not a group', () => {
    const repeated = [{ name: 'f[0].Pt1Line2[0]', exportValue: 'Y' }, { name: 'f[0].Pt1Line2[1]', exportValue: 'Y' }];
    expect(PickOne.pickOneGroups(repeated).size).toBe(0);
    expect(PickOne.othersInGroup(repeated, 'f[0].Pt1Line2[0]')).toEqual([]);
  });

  it('different names are never grouped', () => {
    const boxes = [{ name: 'f[0].A[0]', exportValue: '1' }, { name: 'f[0].B[0]', exportValue: '2' }];
    expect(PickOne.pickOneGroups(boxes).size).toBe(0);
  });

  it('ticking one unticks the others of its group', () => {
    expect(PickOne.othersInGroup(I765_PART1, `${P1}[1]`)).toEqual([`${P1}[0]`, `${P1}[2]`]);
    expect(PickOne.othersInGroup(I765_PART1, 'form1[0].Page1[0].Other[0]')).toEqual([]);
  });

  it('a repeated answer inside a group stays with the box ticked', () => {
    const boxes = [...I765_PART1, { name: `${P1}[3]`, exportValue: '1' }];
    expect(PickOne.othersInGroup(boxes, `${P1}[0]`)).toEqual([`${P1}[1]`, `${P1}[2]`]);
  });

  it('the editor unticks through it and saves each one as "No"', () => {
    expect(portalHtml).toContain('<script src="js/pick-one.js"></script>');
    expect(detailJs).toContain('for (const other of PickOne.othersInGroup(pickBoxes, name)) {');
    expect(detailJs).toContain("recordEdit(other, 'No', widgets[0].section);");
    expect(detailJs).toContain('if (input.checked) untickOthers(ann.fieldName);');
  });
});

describe('field map validator: pick-one WARN', () => {
  it('two literal:true in one group', () => {
    const map = { [`${P1}[0]`]: { type: 'checkbox', source: 'literal:true' }, [`${P1}[1]`]: { type: 'checkbox', source: 'literal:true' }, [`${P1}[2]`]: { type: 'checkbox', source: 'blank' } };
    expect(PickOne.mapConflicts(map, I765_PART1)).toEqual([{ group: P1, names: [`${P1}[0]`, `${P1}[1]`] }]);
  });

  it('two data sources in one group', () => {
    const map = { [`${P1}[0]`]: { type: 'checkbox', source: 'immigration.is_initial' }, [`${P1}[2]`]: { type: 'checkbox', source: 'immigration.is_renewal' } };
    expect(PickOne.mapConflicts(map, I765_PART1)).toHaveLength(1);
  });

  it('one answer, blanks and false literals are fine', () => {
    const map = { [`${P1}[0]`]: { type: 'checkbox', source: 'literal:true' }, [`${P1}[1]`]: { type: 'checkbox', source: 'literal:false' }, [`${P1}[2]`]: { type: 'checkbox', source: 'blank' } };
    expect(PickOne.mapConflicts(map, I765_PART1)).toEqual([]);
  });

  it('one address read through unit_is_ste / flr / apt can tick only one: no WARN', () => {
    const map = Object.fromEntries(['ste', 'flr', 'apt'].map((t, i) => [`${UNIT}[${i}]`, { type: 'checkbox', source: 'client.address_line2', transform: `unit_is_${t}` }]));
    expect(PickOne.mapConflicts(map, I765_UNIT)).toEqual([]);
    // Two different addresses can both be true.
    map[`${UNIT}[1]`].source = 'firm.address_line2';
    expect(PickOne.mapConflicts(map, I765_UNIT)).toHaveLength(1);
  });

  it('the validator reports it as a WARN, not an ERROR', () => {
    expect(validatorJs).toContain("const PickOne = require('../js/pick-one.js');");
    expect(validatorJs).toMatch(/for \(const c of PickOne\.mapConflicts\(fieldMap, boxes\)\) \{\s+warns\.push\(`pick-one group/);
  });
});

// ── Case Builder "+ Add forms" (F-1) ─────────────────────────────────────────

describe('form picker', () => {
  // The file is copied byte for byte from the template, which assigns
  // window.FormPicker; workerd has no window, so lend it globalThis.
  let FormPicker;
  beforeAll(async () => {
    globalThis.window ??= globalThis;
    await import('../../js/form-picker.js');
    FormPicker = globalThis.FormPicker;
  });

  it('js/form-picker.js is present and defines FormPicker.open', () => {
    expect(typeof FormPicker.open).toBe('function');
    expect(FormPicker.matches({ form_key: 'i-130', label: 'Petition for Alien Relative' }, 'I 130')).toBe(true);
    expect(FormPicker.matches({ form_key: 'i-765', label: 'EAD' }, 'i130')).toBe(false);
  });

  it('is loaded by portal.html, as the template does, and Case Builder calls it', () => {
    expect(portalHtml).toContain('<script src="js/form-picker.js"></script>');
    expect(portalHtml.indexOf('js/dk.js')).toBeLessThan(portalHtml.indexOf('js/form-picker.js'));
    expect(draftFormsJs).toContain('FormPicker.open({');
  });
});
