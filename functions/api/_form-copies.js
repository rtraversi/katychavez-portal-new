// Which USCIS forms a case (or a package) may hold more than once, and the
// fee amount a copy carries (Drafter 1.0.4, RT-9, RT-13, D-19). NOT a route.
//
// A DACA case files two G-1450s, one per fee, each with its own amount. Every
// other form stays one per case. To let another form repeat, add its form key
// here; the API, the "+ Add form" picker and Case Builder all read this list.
export const REPEATABLE_FORMS = new Set(['g-1450']);

// The forms whose copies carry an amount (G-1450 AuthorizedPaymentAmt).
export const FEE_FORMS = new Set(['g-1450']);

export const canRepeat = (formKey) => REPEATABLE_FORMS.has(String(formKey || '').toLowerCase());
export const hasFee    = (formKey) => FEE_FORMS.has(String(formKey || '').toLowerCase());

// What staff typed into "Amount" -> whole dollars, or null to clear it.
// Takes "520", "$520", "1,234" and "520.00"; refuses cents and anything else.
// Returns { value } or { error }.
export function parseFeeAmount(input) {
  if (input == null) return { value: null };
  const s = String(input).trim().replace(/^\$\s*/, '').replace(/,/g, '');
  if (s === '') return { value: null };
  const m = s.match(/^(\d{1,7})(?:\.(\d{1,2}))?$/);
  if (!m) return { error: 'Enter the amount in whole dollars, like 520.' };
  if (m[2] && Number(m[2]) !== 0) return { error: 'Whole dollars only: the G-1450 takes no cents.' };
  return { value: Number(m[1]) };
}
