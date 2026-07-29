// Pure parsing helpers for the Monday.com client sync.
//
// Monday's `name` column is free text that staff have used for several jobs at once:
// the beneficiary, the petitioner, filing reminders, accessibility notes and form codes
// all share one field. Nothing here touches the network or the database — every export
// is a pure function so the messy real-world cases can be pinned down in unit tests.
//
// The house rule, confirmed by Rob 2026-07-20:
//
//     Beneficiary (the portal client)  //  Petitioner (if there is one)
//
// `//` is the boundary between the two sides. `&` and `/` join several people on the
// same side of that boundary — except when there is no `//` at all, where a lone `/`
// is the boundary itself.
//
// Everything that cannot be read with confidence is reported as such rather than
// guessed at. A wrong client record is far more expensive to unpick than a review queue
// entry, so `confidence: 'low'` is the correct answer whenever the name is genuinely
// ambiguous — see `parseItemName` for what drives it.

// Name suffixes, stripped before the capitalisation test so `EASON JR` does not read as
// a two-token surname.
const SUFFIXES = new Set(['JR', 'SR', 'II', 'III', 'IV', 'V']);

// Filing reminders staff append to a name ("send in AUGUST!!", "- Mail in SEPTEMBER",
// "file AUG 6", "FILE IN DEC").
//
// These are anchored to the end of a *segment* — a `/` or `&` or the end of the string —
// not to the end of the whole name. A reminder frequently sits on the beneficiary before
// the `//` ("Margarita GONZALEZ CASTILLO send in AUGUST!! // Laura TORRES"), and an
// end-of-string anchor silently left it in place and read "August!!" as the surname.
const REMINDER_RE = /[-–—]?\s*\b(?:file|filed|send|sent|mail|mailed)\b[^/&]*?(?=\s*(?:\/|&|$))/gi;

// USCIS form and stage codes staff append to a name. Same segment anchoring, so a
// legitimate surname containing a digit is untouched.
const FORM_CODE_RE = /[-–—]?\s*\b(?:N-\d{3}|I-\d{2,3}[A-Z]?|G-\d{2,4}|DS-\d{3}|C-\d{2}|CRBA|NVC|CP|AOS|DACA|PIP|AP)\b(?=\s*(?:\/|&|$))/gi;

// A petitioner is sometimes labelled rather than just listed.
const PET_PREFIX_RE = /^\s*(?:pet(?:itioner)?|spouse|husband|wife)\b[.:]?\s+/i;

// Sometimes the beneficiary is described by their relationship instead of named at all
// ("Child of //Ruben Chavez"), usually for a minor whose name isn't on file yet. This
// cannot become a client record — it has to go to review.
const DESCRIPTOR_RE = /^(?:child|son|daughter|wife|husband|spouse|parent|mother|father|minor|baby|infant)(?:\s+of)?$/i;

/**
 * Strip the annotations staff bolt onto a name, returning the cleaned text plus
 * whatever was removed (kept as notes — a "(copy)" or "Can't Read or Write" is
 * information a reviewer needs, not noise to discard silently).
 */
export function stripAnnotations(raw) {
  const notes = [];
  let s = String(raw || '').trim();

  // Parentheticals: "(Edwin's wife)", "(goes by Emilia)", "(copy)".
  s = s.replace(/\(([^)]*)\)/g, (_m, inner) => {
    const t = inner.trim();
    if (t) notes.push(t);
    return ' ';
  });

  // Free-text accessibility / handling notes that carry no parentheses.
  s = s.replace(/\bcan'?t read( or write)?\b/gi, (m) => {
    notes.push(m.trim());
    return ' ';
  });

  // Filing reminders, then trailing form codes. Order matters: the reminder may sit
  // after the form code ("... N-400 file in AUGUST").
  s = s.replace(REMINDER_RE, (m) => {
    const t = m.replace(/^[-–—\s]+/, '').trim();
    if (t) notes.push(t);
    return ' ';
  });
  s = s.replace(FORM_CODE_RE, (m) => {
    const t = m.replace(/^[-–—\s]+/, '').trim();
    if (t) notes.push(t);
    return ' ';
  });

  return { text: s.replace(/\s+/g, ' ').trim(), notes };
}

/** Title-case a token, preserving internal hyphens ("BARRON-MENDEZ" -> "Barron-Mendez"). */
function titleToken(tok) {
  return tok
    .toLowerCase()
    .split('-')
    .map((p) => (p ? p[0].toUpperCase() + p.slice(1) : p))
    .join('-');
}

/**
 * Split one person's name into first/last.
 *
 * The firm's own convention is the strongest signal available: surnames are typed in
 * ALL CAPS ("Berenice REA PEREZ"). Where that signal is present the split is exact and
 * two-part Hispanic surnames come out whole. Where it is absent — an all-caps entry, or
 * one with no caps at all — there is no way to know where the given names stop, so the
 * result is marked low confidence and left for a human.
 */
export function splitPersonName(raw) {
  const cleaned = String(raw || '').replace(/\s+/g, ' ').trim();
  if (!cleaned) return { first_name: '', last_name: '', suffix: '', confidence: 'low' };

  const tokens = cleaned.split(' ');

  // Pull a trailing suffix off before anything else.
  let suffix = '';
  const lastTok = tokens[tokens.length - 1].replace(/[.,]/g, '');
  if (tokens.length > 1 && SUFFIXES.has(lastTok.toUpperCase())) {
    suffix = lastTok.toUpperCase();
    tokens.pop();
  }

  if (tokens.length === 1) {
    // A single token is a surname with no given name — unusable on its own.
    return { first_name: '', last_name: titleToken(tokens[0]), suffix, confidence: 'low' };
  }

  // A single letter is a middle initial ("Maria D ADAME"), not a one-token surname —
  // requiring two characters keeps the initial out of the surname run.
  const isCaps = (t) => t.length > 1 && /[A-Z]/.test(t) && t === t.toUpperCase() && /^[A-Z'\-.]+$/i.test(t);
  const capsFlags = tokens.map(isCaps);
  const capsCount = capsFlags.filter(Boolean).length;

  // The reliable case: some tokens are caps, some are not, and the caps ones are a
  // trailing run. That trailing run is the surname.
  if (capsCount > 0 && capsCount < tokens.length) {
    let start = tokens.length;
    while (start > 0 && capsFlags[start - 1]) start -= 1;

    // Caps appearing mid-name rather than as a trailing run is not the convention —
    // don't pretend to understand it.
    if (start + capsCount === tokens.length && start > 0) {
      return {
        first_name: tokens.slice(0, start).map(titleToken).join(' '),
        last_name: tokens.slice(start).map(titleToken).join(' '),
        suffix,
        confidence: 'high',
      };
    }
  }

  // No usable caps signal. Fall back to "last token is the surname" — right often
  // enough to be a useful starting point, wrong often enough to need review.
  return {
    first_name: tokens.slice(0, -1).map(titleToken).join(' '),
    last_name: titleToken(tokens[tokens.length - 1]),
    suffix,
    confidence: 'low',
  };
}

// Case types that are filed by the beneficiary alone. A second name on one of these is
// worth a second look — it is more likely a note than a petitioner.
const NO_PETITIONER_CASE_TYPES = new Set(['daca', 'naturalization', 'green_card_renewal', 'employment_authorization']);

/**
 * Parse a full Monday item name.
 *
 * The one invariant staff hold to (Rob, 2026-07-20) is that **the first person named is
 * always the beneficiary** — the portal client — whatever separator follows. That makes
 * the client record itself unambiguous even on the messiest rows, so the parse is built
 * around it: `beneficiary` is a single person, and everyone else lands in `others` with
 * the role we can actually justify.
 *
 * `//` marks the following names as petitioners explicitly. A bare `&` or `/` does not
 * say what the second person is — that depends on the case type — so those come back as
 * role `'unknown'` for a human to settle. Crucially that does *not* block the client:
 * only the petitioner link is deferred.
 *
 * Returns `{ beneficiary, others, notes, confidence, issues }`. `confidence` describes
 * the beneficiary parse alone, since that is what gates creating a record.
 */
export function parseItemName(raw, caseTypeKey = null) {
  const { text, notes } = stripAnnotations(raw);
  const issues = [];

  if (!text) {
    return { beneficiary: null, others: [], notes, confidence: 'low', issues: ['Name is empty after cleaning'] };
  }

  // `//` is the explicit beneficiary/petitioner boundary. Without one, a lone `/` takes
  // that role, but with less certainty about what the second person actually is.
  let leftRaw;
  let rightRaw;
  let explicitBoundary = false;
  if (text.includes('//')) {
    const [l, ...rest] = text.split('//');
    leftRaw = l;
    rightRaw = rest.join('//');
    explicitBoundary = true;
  } else if (text.includes('/')) {
    const [l, ...rest] = text.split('/');
    leftRaw = l;
    rightRaw = rest.join('/');
  } else {
    leftRaw = text;
    rightRaw = '';
  }

  const splitSide = (side) =>
    String(side || '')
      .split(/\s*(?:&|\/|\+|\band\b)\s*/i)
      .map((p) => ({ labelled: PET_PREFIX_RE.test(p), name: p.replace(PET_PREFIX_RE, '').trim() }))
      .filter((p) => p.name);

  const left = splitSide(leftRaw);
  const right = splitSide(rightRaw);

  // First person named is the beneficiary, always.
  const beneficiaryIsDescriptor = left.length > 0 && DESCRIPTOR_RE.test(left[0].name.trim());
  const beneficiary = left.length
    ? (beneficiaryIsDescriptor
        ? { first_name: '', last_name: '', suffix: '', confidence: 'low', descriptor: left[0].name.trim() }
        : splitPersonName(left[0].name))
    : null;

  const others = [
    // Anyone else on the left of the boundary: role genuinely unclear.
    ...left.slice(1).map((p) => ({
      ...splitPersonName(p.name),
      role: p.labelled ? 'petitioner' : 'unknown',
    })),
    // Right of the boundary: petitioner when the boundary was an explicit `//`.
    ...right.map((p) => ({
      ...splitPersonName(p.name),
      role: p.labelled || explicitBoundary ? 'petitioner' : 'unknown',
    })),
  ];

  // A dangling separator ("Melecio MARTINEZ RENDON //") means a petitioner was intended
  // but never filled in. Worth surfacing, but it doesn't block the client.
  if (/\/\/\s*$/.test(text) || (/\/\s*$/.test(text) && !text.includes('//'))) {
    issues.push('Trailing separator with no petitioner named');
  }

  if (!beneficiary) {
    issues.push('No beneficiary name found');
  } else if (!beneficiary.first_name) {
    // "Child of //Ruben Chavez" — the beneficiary is described, not named.
    issues.push('Beneficiary has no given name');
  } else if (beneficiary.confidence !== 'high') {
    // The name parsed, but without the ALL-CAPS surname convention there is no way to
    // know where the given names stop. Say so — a reviewer staring at a blank reason
    // has no idea what to check.
    issues.push(
      `Cannot tell where the surname starts (no ALL-CAPS surname) — read as "${beneficiary.first_name}" / "${beneficiary.last_name}"`,
    );
  }

  // Staff mark a duplicated board row "(copy)". Creating a client from one would put the
  // same person in the portal twice, so it always goes to a human.
  if (notes.some((n) => /^copy$/i.test(n.trim()))) {
    issues.push('Marked "(copy)" on the board — likely a duplicate of another item');
  }

  const unknowns = others.filter((o) => o.role === 'unknown');
  if (unknowns.length) {
    issues.push(
      `Role of ${unknowns.length === 1 ? 'a second name' : `${unknowns.length} further names`} unclear — joined without "//"`,
    );
  }
  if (others.length && caseTypeKey && NO_PETITIONER_CASE_TYPES.has(caseTypeKey)) {
    issues.push(`Second name present but ${caseTypeKey} filings have no petitioner`);
  }

  // Confidence gates whether a client record can be created unattended, so it tracks the
  // beneficiary parse — an unclear *petitioner* defers only the petitioner link and does
  // not drag the whole row into review. The one exception is a "(copy)" marker, which
  // says nothing about the name but everything about whether this row should exist.
  const isCopy = notes.some((n) => /^copy$/i.test(n.trim()));
  const blocking = !beneficiary || !beneficiary.first_name || beneficiary.confidence !== 'high' || isCopy;

  return { beneficiary, others, notes, confidence: blocking ? 'low' : 'high', issues };
}

/**
 * Reduce a phone number to its comparable digits.
 *
 * The board holds "(919) 892-0148", "919) 908-4740", "714-252-3238." and
 * "713 294 6594" for what are ordinary US numbers, so comparison has to be on digits
 * alone. A leading US country code is dropped; anything that isn't 10 digits after that
 * is returned as null rather than half-matched.
 */
export function normalizePhone(raw) {
  const digits = String(raw || '').replace(/\D/g, '');
  if (!digits) return null;
  const local = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits;
  return local.length === 10 ? local : null;
}

/**
 * Take the first address out of an email cell.
 *
 * At least one row holds the same address twice separated by a dash
 * ("a@b.com  - a@b.com"), and others hold two different addresses.
 */
export function normalizeEmail(raw) {
  const m = String(raw || '').match(/[^\s,;<>()[\]]+@[^\s,;<>()[\]]+\.[a-z]{2,}/i);
  return m ? m[0].toLowerCase() : null;
}

// Monday's `status_28` (Case) -> the portal's `case_types.key`, using KCL's live keys.
// Codes seen on the board but with no portal equivalent are mapped to null so they
// surface for review rather than silently landing in the wrong case type.
export const CASE_TYPE_MAP = {
  'DACA': 'daca',
  'AOS': 'adjustment_of_status',
  'N-400': 'naturalization',
  'CP': 'consular_processing',
  'NVC': 'consular_processing',
  '601A': 'unlawful_presence_waiver',
  '601': 'inadmissibility_waiver',
  'I-751': 'remove_conditions',
  'ROC': 'remove_conditions',
  'I-90': 'green_card_renewal',
  'PIP': 'parole_in_place',
  'I-130': 'family_based_petition',
  'AP': 'advance_parole',
  'I-131': 'advance_parole',
  'I-765': 'employment_authorization',
  'C-09': 'employment_authorization',
  'C-10': 'employment_authorization',
  'N-600': 'certificate_of_citizenship',
};

// Codes seen on the board that are FORMS, not case types — someone typed a form number
// into the Case column. Mapping them to a case type would be wrong; they belong on the
// matter's form list. Called out by name so they read as "known and deliberate" in the
// review queue rather than as an unrecognised code.
export const FORM_CODES_NOT_CASE_TYPES = new Set(['I-134', 'I-864', 'G-28', 'I-693']);

export function mapCaseType(rawCode) {
  const code = String(rawCode || '').trim().toUpperCase();
  if (!code) return null;
  return CASE_TYPE_MAP[code] || null;
}

/**
 * Decide whether a board item is a client at all.
 *
 * The "Immigration cases" group is not a clean client list — it also holds working
 * notes ("Scanned letters from USCIS", "Label Meanings", "METLIFE BLLING"), the firm's
 * own staff, and email threads ("Re: Brian Gonzales").
 *
 * There is no single field that separates those from a thinly-filled real client, so
 * this looks for *any* sign of casework: a phone, a case type, a Date Hired, or the
 * Type set to Immigration. Real clients with almost nothing filled in still carry at
 * least one; the working notes carry none. Erring toward "client" is deliberate — a
 * false client goes to a review queue, whereas a real client wrongly filtered out
 * disappears silently and nobody notices.
 *
 * Returns a reason string when the item looks like a non-client, or null when it looks
 * like a client. Callers must treat a reason as "send to review", never as "delete".
 */
export function classifyNonClient(item) {
  const name = String(item?.name || '').trim();
  if (!name) return 'Item has no name';

  if (/^re:/i.test(name)) return 'Name starts with "Re:" — looks like an email thread';

  const signals = [
    !!normalizePhone(item?.phone),
    !!String(item?.caseCode || '').trim(),
    !!String(item?.dateHired || '').trim(),
    /immigration/i.test(String(item?.type || '')),
  ];
  if (!signals.some(Boolean)) {
    return 'No phone, case type, date hired or type — does not look like a client record';
  }

  return null;
}
