// Regression: rich-text form fields crash pdfDoc.save().
//
// pdf-lib cannot READ rich-text fields, and save() regenerates every field's
// appearance by reading it — so a single rich-text box (the I-485 Part 14
// "Additional Information") threw "Reading rich text fields is not supported"
// at generate/download time, aborting the whole package. stripRichText()
// downgrades such fields to plain text before save. This builds the exact
// failing shape (rich flag set, no plain /V) and proves the guard fixes it.
import { describe, it, expect } from 'vitest';
import { PDFDocument, PDFName } from 'pdf-lib';
import { stripRichText } from '../../functions/api/_form-fill.js';

async function docWithRichTextField() {
  const doc  = await PDFDocument.create();
  const page = doc.addPage([600, 800]);
  const form = doc.getForm();
  const tf   = form.createTextField('rich.additionalInfo');
  tf.addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
  tf.enableRichFormatting();                       // set the RichText flag
  tf.acroField.dict.delete(PDFName.of('V'));       // …with no readable plain value
  return doc;
}

describe('stripRichText', () => {
  it('reading a rich-text field throws (this is what save() hits internally)', async () => {
    const doc  = await docWithRichTextField();
    const form = doc.getForm();
    expect(() => form.getTextField('rich.additionalInfo').getText()).toThrow(/rich text/i);
  });

  it('downgrades rich-text fields so reading — and save() — succeed', async () => {
    const doc     = await docWithRichTextField();
    const form    = doc.getForm();
    const cleared = stripRichText(form);
    expect(cleared).toBe(1);
    // No longer throws; a rich field with no plain value now reads as empty.
    expect(form.getTextField('rich.additionalInfo').getText()).toBeFalsy();
    const bytes = await doc.save();
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('is a no-op on a form with no rich-text fields', async () => {
    const doc  = await PDFDocument.create();
    const page = doc.addPage([600, 800]);
    const tf   = doc.getForm().createTextField('plain.field');
    tf.addToPage(page, { x: 50, y: 700, width: 200, height: 20 });
    tf.setText('hello');
    expect(stripRichText(doc.getForm())).toBe(0);
    expect((await doc.save()).length).toBeGreaterThan(0);
  });
});
