-- Migration 1600-g1145: G-1145 field map + template registration
--
-- E-Notification of Application/Petition Acceptance. 5 fillable fields,
-- all applicant contact info.
--
-- 5 map entries (5 data-mapped, 0 deliberately blank);
-- 1 XFA barcode field(s) omitted. Field inventory: normalized/g-1145.fields.json.
-- Requires the a_number/unit_*/digits/yes_no_invert transforms shipped in
-- functions/api/_form-fill.js alongside migration 1600-g28.

UPDATE public.form_templates
SET r2_key      = 'form-templates/g-1145.pdf',
    field_count = 6,
    field_map   = '{
  "form1[0].#subform[0].LastName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[0].FirstName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[0].MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[0].Email[0]": {
    "type": "text",
    "source": "client.email"
  },
  "form1[0].#subform[0].MobilePhoneNumber[0]": {
    "type": "text",
    "source": "client.cell_phone",
    "transform": "digits"
  }
}'::jsonb
WHERE form_key = 'g-1145';
