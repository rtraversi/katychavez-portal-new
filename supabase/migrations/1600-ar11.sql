-- Migration 1600-ar11: AR-11 field map + template registration
--
-- USCIS Form AR-11, Alien's Change of Address Card. A short form used to report a new address to USCIS. Collects the filer's name, DOB, A-number, and present physical (new) address.
--
-- Source:  uscis-forms/ar-11.pdf
-- Edition: 11/02/22 (printed lower-left; title "Alien's Change of Address Card")
-- SHA-256: f02879c3dcb820468e24d0dc6987c232ae6bb5ae0814881f80f3d606251cd0ff
--
-- 31 fields: 9 data-mapped, 22 deliberately blank.
-- Field inventory: normalized/ar-11.fields.json
-- Field semantics: normalized/ar-11.tooltips.tsv
--
-- Mapping decisions:
--  * Autofilled: filer legal name, DOB, A-number, and present physical address
--    (mapped from the client's CURRENT address on file — which is the new address
--    being reported once the client record is updated).
--  * Left blank on purpose:
--    - Optional separate mailing address (only if different from physical).
--    - Last/previous address — no address history in the data model.
--    - Signature — hard rule.

INSERT INTO public.form_templates (form_key, label) VALUES
  ('ar-11', 'Form AR-11 -- Alien''s Change of Address Card')
ON CONFLICT (form_key) DO NOTHING;

UPDATE public.form_templates
SET r2_key       = 'form-templates/ar-11.pdf',
    field_count  = 31,
    edition_date = '11/02/22',
    field_map    = '{
  "form1[0].#subform[0].S1_MiddleName[0]": {
    "type": "text",
    "source": "client.middle_name"
  },
  "form1[0].#subform[0].S1_GivenName[0]": {
    "type": "text",
    "source": "client.first_name"
  },
  "form1[0].#subform[0].S1_FamilyName[0]": {
    "type": "text",
    "source": "client.last_name"
  },
  "form1[0].#subform[0].S1_DateOfBirth[0]": {
    "type": "text",
    "source": "client.dob",
    "transform": "date_slash"
  },
  "form1[0].#subform[0].S2B_State[0]": {
    "type": "dropdown",
    "source": "client.state",
    "transform": "state_abbrev"
  },
  "form1[0].#subform[0].S2B_ZipCode[0]": {
    "type": "text",
    "source": "client.zip"
  },
  "form1[0].#subform[0].S2B__Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].S2B_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].S2B__Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].S2B__Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].S2B_StreetNumberName[0]": {
    "type": "text",
    "source": "client.address_line1"
  },
  "form1[0].#subform[0].S2B_CityOrTown[0]": {
    "type": "text",
    "source": "client.city"
  },
  "form1[0].#subform[0].S2C_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[0].S2C_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].S2C_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].S2C_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].S2C_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].S2C_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].S2C_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].S2C_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].AlienNumber[0]": {
    "type": "text",
    "source": "immigration.a_number",
    "transform": "a_number"
  },
  "form1[0].#subform[0].S3_SignatureApplicant[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].S3_DateofSignature[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].S2A_State[0]": {
    "type": "dropdown",
    "source": "blank"
  },
  "form1[0].#subform[0].S2A_ZipCode[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].S2A_Unit[0]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].S2A_AptSteFlrNumber[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].S2A_Unit[1]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].S2A_Unit[2]": {
    "type": "checkbox",
    "source": "blank"
  },
  "form1[0].#subform[0].S2A_StreetNumberName[0]": {
    "type": "text",
    "source": "blank"
  },
  "form1[0].#subform[0].S2A_CityOrTown[0]": {
    "type": "text",
    "source": "blank"
  }
}'::jsonb
WHERE form_key = 'ar-11';

INSERT INTO public.form_editions (form_number, pages, edition_date) VALUES
  ('AR-11', 2, '11/02/22')
ON CONFLICT (form_number) DO UPDATE
  SET pages        = EXCLUDED.pages,
      edition_date = EXCLUDED.edition_date,
      updated_at   = now();
