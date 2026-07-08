-- Migration 1600-i765ws: I-765WS field map + template registration
--
-- I-765 Worksheet (economic need). Only the name header is autofilled;
-- income/expenses/assets and the need statement are case-specific narrative
-- the attorney/client must author -- deliberately blank.
--
-- 8 map entries (3 data-mapped, 5 deliberately blank);
-- 1 XFA barcode field(s) omitted. Field inventory: normalized/i-765ws.fields.json.
-- Requires the a_number/unit_*/digits/yes_no_invert transforms shipped in
-- functions/api/_form-fill.js alongside migration 1600-g28.

UPDATE public.form_templates
SET r2_key      = 'form-templates/i-765ws.pdf',
    field_count = 9,
    field_map   = '{
  "form1[0].#subform[0].Line1a_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[0].Line1b_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[0].Line1c_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[0].Line1_IndividualAnnualIncome[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Line2_IndividualAnnualExpense[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Line3_TotalAssets[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Statement_From_Applicant[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].Statement_From_Applicant[1]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'i-765ws';
