-- Migration 1600-g28-atty-fields: wire the new per-attorney professional
-- columns (migration 1521) into the G-28 field map. jsonb || merge -- only
-- these three entries change, the rest of the map is untouched.
--
--   Pt2Line1a_LicensingAuthority  <- users.licensing_authority
--   Pt1Line1_USCISOnlineAcctNumber<- users.uscis_account_number (maxLen 12)
--   Pt1ItemNumber7_FaxNumber      <- users.fax (digits; maxLen 10)
--
-- Requires 1521 (columns) and the Worker deploy that selects them in
-- form-filler-generate.js.

UPDATE public.form_templates
SET field_map = field_map || '{
  "form1[0].#subform[0].Pt2Line1a_LicensingAuthority[0]":            { "type": "text", "source": "attorney.licensing_authority" },
  "form1[0].#subform[0].#area[0].Pt1Line1_USCISOnlineAcctNumber[0]": { "type": "text", "source": "attorney.uscis_account_number" },
  "form1[0].#subform[0].Pt1ItemNumber7_FaxNumber[0]":                { "type": "text", "source": "attorney.fax", "transform": "digits" }
}'::jsonb
WHERE form_key = 'g-28';
