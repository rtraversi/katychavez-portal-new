// Drafter 1.0.1: state, ZIP, middle name, phones, file names.
//
// The card keeps what staff type (a ZIP+4, a formatted phone, a blank state);
// the forms get what their boxes take (5 ZIP digits, bare phone digits).
import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import { applyFieldMap, cleanForBox } from '../../functions/api/_form-fill.js';
import { withPhoneFallback } from '../../functions/api/_fill-context.js';
import { formFileName, contentDisposition } from '../../functions/api/_form-file-name.js';
import '../../js/contact-format.js';

const CF = globalThis.ContactFormat;

async function formWith(names) {
  const doc  = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  names.forEach((n, i) => form.createTextField(n).addToPage(page, { x: 50, y: 700 - i * 30, width: 200, height: 20 }));
  return form;
}

describe('ZIP: forms get the first 5 digits', () => {
  it('cuts a ZIP+4 from any "zip" or "*_zip" column', () => {
    expect(cleanForBox('client.zip', '27609-1234')).toBe('27609');
    expect(cleanForBox('client.zip', '276091234')).toBe('27609');
    expect(cleanForBox('client.employer_zip', '27609-1234')).toBe('27609');
    expect(cleanForBox('petitioner.zip', '27609')).toBe('27609');
    expect(cleanForBox('immigration.family.0.zip', '12345-6789')).toBe('12345');
  });

  it('leaves other columns and literals alone', () => {
    expect(cleanForBox('client.zipper', '12345-6789')).toBe('12345-6789');
    expect(cleanForBox('literal:12345-6789', '12345-6789')).toBe('12345-6789');
    expect(cleanForBox('client.city', 'Raleigh')).toBe('Raleigh');
    expect(cleanForBox('client.zip', null)).toBe(null);
  });

  it('is what applyFieldMap writes into the box', async () => {
    const form = await formWith(['zip']);
    applyFieldMap(form, { zip: { type: 'text', source: 'client.zip' } }, { client: { zip: '27609-1234' } }, {});
    expect(form.getTextField('zip').getText()).toBe('27609');
  });
});

describe('phones: forms get digits only', () => {
  it('reduces any "*phone" column and "fax" to digits', () => {
    expect(cleanForBox('client.cell_phone', '(919) 388-8328')).toBe('9193888328');
    expect(cleanForBox('client.phone', '919.388.8328')).toBe('9193888328');
    expect(cleanForBox('petitioner.home_phone', '(919) 388-8328')).toBe('9193888328');
    expect(cleanForBox('attorney.fax', '(919) 555-0100')).toBe('9195550100');
    expect(cleanForBox('firm.fax', '919-555-0100')).toBe('9195550100');
  });

  it('is what applyFieldMap writes into the box', async () => {
    const form = await formWith(['cell', 'fax']);
    applyFieldMap(form, {
      cell: { type: 'text', source: 'client.cell_phone' },
      fax:  { type: 'text', source: 'firm.fax' },
    }, { client: { cell_phone: '(919) 388-8328' }, firm: { fax: '(919) 555-0100' } }, {});
    expect(form.getTextField('cell').getText()).toBe('9193888328');
    expect(form.getTextField('fax').getText()).toBe('9195550100');
  });
});

describe('cell phone fallback (RT-16)', () => {
  it('an old client with only the old phone column fills cell_phone', () => {
    expect(withPhoneFallback({ phone: '9193888328', cell_phone: null }).cell_phone).toBe('9193888328');
    expect(withPhoneFallback({ phone: '9193888328', cell_phone: '' }).cell_phone).toBe('9193888328');
  });

  it('a saved cell phone wins, and also fills maps that read the old column', () => {
    expect(withPhoneFallback({ phone: '1111111111', cell_phone: '9193888328' })).toMatchObject({ cell_phone: '9193888328', phone: '1111111111' });
    expect(withPhoneFallback({ phone: null, cell_phone: '9193888328' }).phone).toBe('9193888328');
    expect(withPhoneFallback(null)).toEqual({});
  });
});

describe('file names (RT-12)', () => {
  it('is "<FORM NUMBER> - <CLIENT LAST NAME>.pdf", in capitals', () => {
    expect(formFileName('g-28', 'Ejemplo Vargas')).toBe('G-28 - EJEMPLO VARGAS.pdf');
    expect(formFileName('i-485', 'nguyễn')).toBe('I-485 - NGUYỄN.pdf');
  });

  it('is just the form number with no last name', () => {
    expect(formFileName('i-765', '')).toBe('I-765.pdf');
    expect(formFileName('i-765', null)).toBe('I-765.pdf');
    expect(formFileName('i-765', '   ')).toBe('I-765.pdf');
  });

  it('drops characters a file name cannot hold', () => {
    expect(formFileName('g-28', 'O"Brien/Smith')).toBe('G-28 - OBRIENSMITH.pdf');
  });

  it('a download header always holds, whatever the letters', () => {
    const h = contentDisposition('I-485 - NGUYỄN.pdf');
    expect(h).toMatch(/^inline; filename="I-485 - NGUYEN\.pdf"; filename\*=UTF-8''/);
    expect(decodeURIComponent(h.split("UTF-8''")[1])).toBe('I-485 - NGUYỄN.pdf');
    expect(() => new Headers({ 'Content-Disposition': h })).not.toThrow();
  });
});

describe('the State dropdown', () => {
  it('saves null when nothing is picked, never a default', () => {
    expect(CF.stateValue('')).toBe(null);
    expect(CF.stateValue('   ')).toBe(null);
    expect(CF.stateValue(null)).toBe(null);
    expect(CF.stateValue('nc')).toBe('NC');
  });

  it('starts on the empty choice and lists the states, DC and the territories', () => {
    const html = CF.stateOptions('');
    expect(html.startsWith('<option value="" selected></option>')).toBe(true);
    expect(html).not.toMatch(/value="TX" selected/);
    expect(CF.STATES).toHaveLength(56);
    for (const code of ['NC', 'TX', 'DC', 'PR', 'GU', 'VI', 'AS', 'MP']) expect(CF.STATES).toContain(code);
  });

  it('keeps a saved value selected, even one not on the list', () => {
    expect(CF.stateOptions('NC')).toMatch(/<option value="NC" selected>/);
    expect(CF.stateOptions('NC')).toMatch(/^<option value=""><\/option>/);
    expect(CF.stateOptions('Texas')).toMatch(/<option value="TEXAS" selected>TEXAS<\/option>/);
  });
});

describe('formatting as staff type', () => {
  it('ZIP: digits only, at most 9; 9 digits show as ZIP+4', () => {
    expect(CF.formatZip('27609')).toBe('27609');
    expect(CF.formatZip('2760a9')).toBe('27609');
    expect(CF.formatZip('276091')).toBe('276091');
    expect(CF.formatZip('276091234')).toBe('27609-1234');
    expect(CF.formatZip('27609-12345')).toBe('27609-1234');
  });

  it('phone: a US number shows as (919) 388-8328; anything else stays as typed', () => {
    expect(CF.formatPhone('9193888328')).toBe('(919) 388-8328');
    expect(CF.formatPhone('919.388.8328')).toBe('(919) 388-8328');
    expect(CF.formatPhone('+1 919 388 8328')).toBe('(919) 388-8328');
    expect(CF.formatPhone('19193888328')).toBe('(919) 388-8328');
    expect(CF.formatPhone('(919) 388-8328')).toBe('(919) 388-8328');
    expect(CF.formatPhone('919388')).toBe('919388');
    expect(CF.formatPhone('+52 55 1234 5678')).toBe('+52 55 1234 5678');
    expect(CF.formatPhone('29193888328')).toBe('29193888328');
  });
});
