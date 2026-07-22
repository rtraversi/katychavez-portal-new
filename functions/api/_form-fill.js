// Shared resolver for the USCIS form filler.
//
// Consumes a form_templates.field_map (hand-authored JSON, keyed by exact
// AcroForm field name) against a "fill context" assembled per matter, and
// applies values to a pdf-lib PDFForm. See supabase/migrations/1511_form_filler_schema.sql
// for the field_map jsonb column, and scripts/normalize-form-template.js for
// how the field names themselves are inventoried.
//
// field_map shape:
//   {
//     "<exact pdf field name>": {
//       "type": "text" | "checkbox" | "dropdown",
//       "source": "client.<col>" | "matter.<col>" | "immigration.<col>" |
//                 "immigration.family.<n>.<col>" | "firm.<col>" | "attorney.<col>" |
//                 "petitioner.<col>" | "joint_sponsor.<col>" |
//                 "literal:<value>" | "blank",
//       "transform"?: "state_abbrev" | "yes_no" | "date_mmddyyyy" | "date_slash"
//     },
//     ...
//   }
//
// fill context shape: { client, matter, immigration, familyMembers, firm,
//                       attorney, petitioner, joint_sponsor }
//
// "petitioner" is the matter's primary opposing_parties row (migration 1602):
// in immigration matters the client is the beneficiary and this record is the
// sponsoring petitioner (I-130 Part 2, I-864 sponsor block, etc.).
// "joint_sponsor" is the optional party_role='joint_sponsor' row (migration
// 1604) — the I-864 joint financial sponsor when the petitioner can't meet
// the income requirement alone.

import { PDFTextField, PDFCheckBox, PDFDropdown, PDFRadioGroup } from 'pdf-lib';
import { ssnDecrypt } from './_helpers.js';

const STATE_ABBREV = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA',
  colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA',
  kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO',
  montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH', 'new jersey': 'NJ',
  'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH',
  oklahoma: 'OK', oregon: 'OR', pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC',
  'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

// Leading unit-type designators in an address_line2 ("Suite 400", "Apt. 2B", "# 12").
const UNIT_TYPE_RE = /^\s*(?:apt|apartment|ste|suite|flr|floor|unit|no|#)\.?\s*#?\s*/i;

function unitType(value) {
  const v = String(value).trim().toLowerCase();
  if (/^apt|^apartment/.test(v)) return 'apt';
  if (/^ste|^suite/.test(v)) return 'ste';
  if (/^flr|^floor/.test(v)) return 'flr';
  return null;
}

export function applyTransform(value, transform) {
  if (value == null || value === '') return value;
  switch (transform) {
    case 'state_abbrev': {
      const v = String(value).trim();
      if (v.length === 2) return v.toUpperCase();
      return STATE_ABBREV[v.toLowerCase()] || v;
    }
    // A-numbers are stored displayed-style ("A123456789") but USCIS ANumber
    // boxes take digits only (maxLength 9).
    case 'a_number': {
      const digits = String(value).replace(/\D/g, '');
      return digits.length > 9 ? digits.slice(-9) : digits;
    }
    // "Suite 400" -> "400": the unit-type word belongs in the Apt/Ste/Flr
    // checkboxes, only the number fits the small AptSteFlrNumber box.
    case 'unit_number':
      return String(value).replace(UNIT_TYPE_RE, '').trim();
    case 'unit_is_apt':
      return unitType(value) === 'apt' ? 'Yes' : 'No';
    case 'unit_is_ste':
      return unitType(value) === 'ste' ? 'Yes' : 'No';
    case 'unit_is_flr':
      return unitType(value) === 'flr' ? 'Yes' : 'No';
    case 'yes_no':
      return value === true || value === 'true' || value === 'Yes' ? 'Yes' : 'No';
    // Inverse boolean, for negatively-phrased checkboxes ("I am NOT in
    // immigration detention" driven by immigration.is_detained).
    case 'yes_no_invert':
      return value === true || value === 'true' || value === 'Yes' ? 'No' : 'Yes';
    // Strip formatting from numeric identifiers (SSN, phone) — USCIS boxes
    // take bare digits.
    case 'digits':
      return String(value).replace(/\D/g, '');
    case 'date_mmddyyyy': {
      const d = new Date(`${value}T12:00:00`);
      if (isNaN(d)) return value;
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${mm}${dd}${d.getFullYear()}`;
    }
    case 'date_slash': {
      const d = new Date(`${value}T12:00:00`);
      if (isNaN(d)) return value;
      const mm = String(d.getMonth() + 1).padStart(2, '0');
      const dd = String(d.getDate()).padStart(2, '0');
      return `${mm}/${dd}/${d.getFullYear()}`;
    }
    default:
      return value;
  }
}

// Resolves a dotted-path source ("prefix.path") against the fill context.
// Supports one level of array indexing for "immigration.family.<n>.<col>".
export function resolvePath(source, context, env) {
  if (source === 'blank') return { skip: true };
  if (source.startsWith('literal:')) return { value: source.slice('literal:'.length) };

  const dotIdx = source.indexOf('.');
  if (dotIdx === -1) return { skip: true };
  const prefix = source.slice(0, dotIdx);
  const rest   = source.slice(dotIdx + 1);

  if (prefix === 'immigration' && rest.startsWith('family.')) {
    const parts = rest.split('.'); // ['family', '<n>', '<col>']
    const idx   = Number(parts[1]);
    const col   = parts[2];
    const member = context.familyMembers?.[idx];
    if (!member) return { skip: true }; // fewer family members than mapped — leave blank, don't error
    return { value: member[col] };
  }

  if ((prefix === 'client' || prefix === 'petitioner' || prefix === 'joint_sponsor') && rest === 'ssn_full') {
    const encrypted = context[prefix]?.ssn_encrypted;
    if (!encrypted) return { skip: true };
    try {
      return { value: ssnDecrypt(encrypted, env) };
    } catch (err) {
      console.error('[_form-fill] ssn decrypt failed:', err.message);
      return { skip: true };
    }
  }

  if ((prefix === 'attorney' || prefix === 'petitioner' || prefix === 'joint_sponsor') && rest === 'full_name') {
    const a = context[prefix];
    if (!a) return { skip: true };
    const name = `${a.first_name || ''} ${a.last_name || ''}`.trim();
    return { value: name || null };
  }

  const bucket = context[prefix];
  if (!bucket) return { skip: true };
  return { value: bucket[rest] };
}

// Applies a field_map against a pdf-lib PDFForm, filling whatever it can.
// One bad/renamed field logs a warning and is skipped rather than aborting
// the whole form — USCIS occasionally renames fields between form editions.
export function applyFieldMap(pdfForm, fieldMap, context, env) {
  let filledCount = 0;
  let totalCount  = 0;
  const warnings  = [];

  for (const [fieldName, descriptor] of Object.entries(fieldMap || {})) {
    totalCount++;
    try {
      const resolved = resolvePath(descriptor.source, context, env);
      if (resolved.skip) continue;

      let value = resolved.value;
      if (value == null || value === '') continue;
      if (descriptor.transform) value = applyTransform(value, descriptor.transform);

      switch (descriptor.type) {
        case 'text': {
          const field = pdfForm.getTextField(fieldName);
          const text  = String(value);
          // Some USCIS fields are authored with maxLengths no real value fits
          // (G-28's attorney email box allows 10 chars). Raise the limit rather
          // than truncate — the attorney reviews the draft before filing.
          const maxLen = field.getMaxLength();
          if (maxLen !== undefined && text.length > maxLen) {
            field.setMaxLength(text.length);
            warnings.push(`${fieldName}: raised maxLength ${maxLen} -> ${text.length}`);
          }
          field.setText(text);
          filledCount++;
          break;
        }
        case 'checkbox': {
          const field = pdfForm.getCheckBox(fieldName);
          const truthy = value === true || value === 'true' || value === 'Yes' || value === 'yes';
          if (truthy) field.check(); else field.uncheck();
          filledCount++;
          break;
        }
        case 'dropdown': {
          const field = pdfForm.getDropdown(fieldName);
          field.select(String(value));
          filledCount++;
          break;
        }
        default:
          warnings.push(`${fieldName}: unknown type "${descriptor.type}"`);
      }
    } catch (err) {
      warnings.push(`${fieldName}: ${err.message}`);
    }
  }

  if (warnings.length) console.warn('[_form-fill] field warnings:', warnings);

  return { filledCount, totalCount, warnings };
}

// Applies per-matter manual edits (form_field_edits rows, migration 1603)
// AFTER applyFieldMap, so they win over both autofill and firm_overrides.
// Values are strings as they should appear; checkboxes take 'Yes'/'No'; an
// empty string deliberately blanks a field autofill may have populated.
// Field type is detected from the live PDF field (edits can target fields
// the map never mentions), so unknown/renamed names just warn and skip.
export function applyManualEdits(pdfForm, edits) {
  let appliedCount = 0;
  const warnings = [];

  for (const [fieldName, raw] of Object.entries(edits || {})) {
    try {
      const field = pdfForm.getField(fieldName);
      const value = raw == null ? '' : String(raw);

      if (field instanceof PDFTextField) {
        const maxLen = field.getMaxLength();
        if (maxLen !== undefined && value.length > maxLen) {
          field.setMaxLength(value.length);
          warnings.push(`${fieldName}: raised maxLength ${maxLen} -> ${value.length}`);
        }
        field.setText(value);
      } else if (field instanceof PDFCheckBox) {
        const truthy = value === 'Yes' || value === 'yes' || value === 'true';
        if (truthy) field.check(); else field.uncheck();
      } else if (field instanceof PDFDropdown) {
        if (value === '') field.clear(); else field.select(value);
      } else if (field instanceof PDFRadioGroup) {
        if (value === '') field.clear(); else field.select(value);
      } else {
        warnings.push(`${fieldName}: unsupported field class for manual edit`);
        continue;
      }
      appliedCount++;
    } catch (err) {
      warnings.push(`${fieldName}: ${err.message}`);
    }
  }

  if (warnings.length) console.warn('[_form-fill] manual edit warnings:', warnings);

  return { appliedCount, warnings };
}
