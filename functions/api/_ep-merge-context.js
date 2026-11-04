// Estate-planning merge context: questionnaire answers → the flat object a Word
// template is rendered against (docxtemplater, {{ }} delimiters).
//
// THE PLACEHOLDER CONTRACT. Templates may use exactly the keys documented here;
// scripts/ep/audit-templates.mjs fails a template that uses any other key, because
// nullGetter turns a typo into a silent blank.
//
//   Principal (the person signing — the client, or for role 'spouse' the spouse)
//     principal_name · principal_name_upper · principal_dob_long · principal_phone
//     principal_email · principal_address (multi-line) · principal_address_inline
//     principal_county · principal_county_upper · principal_county_line
//       ("Wake County, North Carolina", or BLANK when outside NC / unknown)
//     state_name ("North Carolina")
//   The other spouse
//     has_spouse · spouse_name
//   Fiduciary lists — prefix ∈ executor | guardian | trustee | poa_agent | hc_agent
//     <prefix>s                     array of { n, name, relationship, address,
//                                    address_inline, phone, email, is_first }
//     <prefix>_1_name … _3_name     and _relationship _address _address_inline
//                                    _phone _email for 1..3
//     has_<prefix>_1 … has_<prefix>_3
//   HIPAA
//     hipaa_people (array of { name, relationship }) · hipaa_people_list (one per line)
//     has_hipaa_people
//   Children
//     children (array of { name, dob_long }) · children_list ("A, B and C")
//     children_detail ("A (born March 2, 2015) and B") · has_children
//   Family / distribution
//     marital_phrase ("married to Jose Lopez" | "unmarried" | BLANK when unanswered)
//     distribution_age ("25", or BLANK when staggered / to discuss / unanswered)
//     specific_gifts (array of { item, recipient }) · has_specific_gifts
//   Firm / dates
//     firm_name · attorney_name · today_long ("November 4, 2026") · year
//
// Missing values render as BLANK ("__________"), never as an empty string: a gap in
// "appoint ________ as my agent" reads as a gap, while "appoint  as my agent" reads
// as a typo (Rondinelli lesson). has_* flags are real booleans for {{#…}} sections.
//
// What this does NOT do, on purpose: it never fills a principal's initials or ticks a
// choice on a statutory form. In the NC living will and statutory POA the principal
// initials those lines by hand at signing; pre-filling them would defeat the form.
// The client's answers to those questions are shown to the attorney on the card.
//
// Couples / reciprocal documents: one questionnaire covers both spouses. With
// role 'spouse' the spouse becomes the principal, and any fiduciary row the client
// marked relationship 'spouse' ("my spouse, Ana") becomes the client — so the same
// list drafts both mirror-image documents.

export const BLANK = '__________';
export const FIDUCIARY_PREFIXES = ['executor', 'guardian', 'trustee', 'poa_agent', 'hc_agent'];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];

const REL_TEXT = {
  spouse: 'my spouse', child: 'my child', parent: 'my parent', sibling: 'my sibling',
  grandchild: 'my grandchild', other_relative: 'my relative', friend: 'my friend', other: '',
};

const or = (v) => (v == null || String(v).trim() === '' ? BLANK : String(v).trim());

export function longDate(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso || ''));
  if (!m) return BLANK;
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`;
}

function inline(addr) {
  if (!addr) return BLANK;
  return String(addr).split(/\r?\n/).map(s => s.trim()).filter(Boolean).join(', ') || BLANK;
}

export function joinNames(names) {
  const n = names.filter(Boolean);
  if (!n.length) return BLANK;
  if (n.length === 1) return n[0];
  return `${n.slice(0, -1).join(', ')} and ${n[n.length - 1]}`;
}

function relText(row) {
  if (!row) return '';
  if (row.relationship === 'other' || row.relationship === 'other_relative') {
    return row.relationship_other ? String(row.relationship_other).trim() : (REL_TEXT[row.relationship] || '');
  }
  return REL_TEXT[row.relationship] || '';
}

function sec(answers, key) {
  const s = answers?.[key];
  return s && typeof s === 'object' && !Array.isArray(s) ? s : {};
}

/**
 * @param {object} p
 * @param {object} p.answers   validated questionnaire answers (ep_intake_requests.answers)
 * @param {object} [p.client]  clients row — fallback for name/email/phone/address
 * @param {'client'|'spouse'} [p.role]
 * @param {string} [p.firmName]
 * @param {string} [p.attorneyName]
 * @param {Date}   [p.now]
 */
export function buildEstateContext({ answers = {}, client = {}, role = 'client', firmName, attorneyName, now = new Date() } = {}) {
  const you = sec(answers, 'client');
  const mar = sec(answers, 'marriage');
  const married = mar.status === 'married' || mar.status === 'separated';

  const clientName = you.full_legal_name
    || [client.first_name, client.middle_name, client.last_name].filter(Boolean).join(' ');
  const clientAddress = you.address
    || [client.address_line1, client.address_line2,
        [client.city, client.state].filter(Boolean).join(', ') + (client.zip ? ` ${client.zip}` : '')]
        .map(s => (s || '').trim()).filter(Boolean).join('\n');
  const clientSide = {
    name: clientName, dob: you.dob || client.dob, phone: you.phone || client.phone || client.cell_phone,
    email: you.email || client.email, address: clientAddress,
  };
  const spouseSide = {
    name: mar.spouse_name, dob: mar.spouse_dob, phone: mar.spouse_phone, email: mar.spouse_email,
    address: clientAddress,          // same household unless the attorney edits the document
  };

  const asSpouse = role === 'spouse' && married;
  const principal = asSpouse ? spouseSide : clientSide;
  const other     = asSpouse ? clientSide : spouseSide;

  const county = you.county && you.county !== 'outside_nc' ? you.county : '';

  const ctx = {
    principal_name:           or(principal.name),
    principal_name_upper:     principal.name ? String(principal.name).trim().toUpperCase() : BLANK,
    principal_dob_long:       longDate(principal.dob),
    principal_phone:          or(principal.phone),
    principal_email:          or(principal.email),
    principal_address:        or(principal.address),
    principal_address_inline: inline(principal.address),
    principal_county:         or(county),
    principal_county_upper:   county ? county.toUpperCase() : BLANK,
    principal_county_line:    county ? `${county} County, North Carolina` : BLANK,
    state_name:               'North Carolina',
    has_spouse:               married && !!mar.spouse_name,
    spouse_name:              married ? or(other.name) : BLANK,
    firm_name:                or(firmName),
    attorney_name:            or(attorneyName),
    today_long:               longDate(now.toISOString()),
    year:                     String(now.getUTCFullYear()),
  };

  // ── Fiduciaries ───────────────────────────────────────────────────────────
  const lists = {
    executor:  sec(answers, 'executors').list,
    guardian:  sec(answers, 'guardians').list,
    // "Same people as my Executors" stands in for an empty successor-trustee list.
    trustee:   (sec(answers, 'trust').successor_trustees || []).length
                 ? sec(answers, 'trust').successor_trustees
                 : (sec(answers, 'trust').same_as_executor === 'yes' ? sec(answers, 'executors').list : []),
    poa_agent: sec(answers, 'poa').agents,
    hc_agent:  sec(answers, 'health').agents,
  };

  for (const prefix of FIDUCIARY_PREFIXES) {
    const rows = (Array.isArray(lists[prefix]) ? lists[prefix] : []).slice(0, 3).map(r => {
      // Reciprocal swap: "my spouse" in the client's list is the client, when
      // drafting the spouse's document.
      if (asSpouse && r.relationship === 'spouse') {
        return { ...r, name: clientSide.name, phone: clientSide.phone, email: clientSide.email,
                 address: r.address || clientSide.address };
      }
      return r;
    });
    const people = rows.map((r, i) => ({
      n: i + 1,
      name: or(r.name),
      relationship: relText(r) || BLANK,
      address: or(r.address || r.city_state),
      address_inline: inline(r.address || r.city_state),
      phone: or(r.phone),
      email: or(r.email),
      is_first: i === 0,
    }));
    ctx[`${prefix}s`] = people;
    for (let i = 1; i <= 3; i++) {
      const p = people[i - 1];
      ctx[`has_${prefix}_${i}`] = !!p;
      for (const k of ['name', 'relationship', 'address', 'address_inline', 'phone', 'email']) {
        ctx[`${prefix}_${i}_${k}`] = p ? p[k] : BLANK;
      }
    }
  }

  // ── HIPAA ─────────────────────────────────────────────────────────────────
  const hipaa = (sec(answers, 'health').hipaa_people || []).map(r => {
    if (asSpouse && r.relationship === 'spouse') return { name: or(clientSide.name), relationship: 'my spouse' };
    return { name: or(r.name), relationship: relText(r) || BLANK };
  });
  ctx.hipaa_people = hipaa;
  ctx.has_hipaa_people = hipaa.length > 0;
  ctx.hipaa_people_list = hipaa.length
    ? hipaa.map(h => (h.relationship && h.relationship !== BLANK ? `${h.name} (${h.relationship})` : h.name)).join('\n')
    : BLANK;

  // ── Children ──────────────────────────────────────────────────────────────
  const kids = (sec(answers, 'children').list || []).filter(c => c.living !== 'no');
  ctx.children = kids.map(c => ({ name: or(c.name), dob_long: longDate(c.dob) }));
  ctx.has_children = kids.length > 0;
  ctx.children_list = joinNames(kids.map(c => c.name));
  ctx.children_detail = joinNames(kids.map(c => (c.dob ? `${c.name} (born ${longDate(c.dob)})` : c.name)));

  // ── Family / distribution ─────────────────────────────────────────────────
  // Only what the client actually said: an unanswered status is a blank, not "unmarried".
  ctx.marital_phrase = married
    ? (other.name ? `married to ${String(other.name).trim()}` : BLANK)
    : (['single', 'divorced', 'widowed'].includes(mar.status) ? 'unmarried' : BLANK);
  const age = sec(answers, 'distribution').young_beneficiary_age;
  ctx.distribution_age = /^\d+$/.test(age || '') ? age : BLANK;
  const gifts = (sec(answers, 'distribution').specific_gifts || []).map(g => ({ item: or(g.item), recipient: or(g.recipient) }));
  ctx.specific_gifts = gifts;
  ctx.has_specific_gifts = gifts.length > 0;

  return ctx;
}

// Every key buildEstateContext can produce, for the template audit. Derived from a
// fully-populated run so it can't drift from the builder.
export function contextKeys() {
  const ctx = buildEstateContext({ answers: {}, client: {} });
  const keys = new Set(Object.keys(ctx));
  // Loop item keys (inside {{#executors}}…{{/executors}} etc.)
  for (const k of ['n', 'name', 'relationship', 'address', 'address_inline', 'phone', 'email', 'is_first', 'dob_long', 'item', 'recipient']) keys.add(k);
  return keys;
}
