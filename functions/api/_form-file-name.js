// The name of a generated USCIS form, for its draft, finalized and signed
// copies alike (Drafter 1.0.1, RT-12): "<FORM NUMBER> - <CLIENT LAST NAME>.pdf",
// e.g. "G-28 - EJEMPLO VARGAS.pdf"; just the form number when there is no last
// name. Characters a file name cannot hold are dropped.
export function formFileName(formKey, lastName) {
  const clean = (s) => String(s ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
  const form = clean(formKey) || 'FORM';
  const last = clean(lastName);
  return `${last ? `${form} - ${last}` : form}.pdf`;
}

// A Content-Disposition value for that name. Header values must be plain
// bytes, and a last name can carry any letter ("NGUYỄN"), so the plain
// filename drops what does not fit and filename* carries the full name.
export function contentDisposition(fileName, kind = 'inline') {
  const name = String(fileName || 'form.pdf');
  const ascii = name.normalize('NFKD').replace(/[^\x20-\x7e]/g, '').replace(/["\\]/g, '') || 'form.pdf';
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}
