-- Migration 1600-i765-atty-fields: wire users.uscis_account_number (migration
-- 1521) into the I-765 attorney header. jsonb || merge -- one entry.
--
--   Attorney-Rep USCISELISAcctNumber <- users.uscis_account_number (maxLen 12)

UPDATE public.form_templates
SET field_map = field_map || '{
  "form1[0].Page1[0].Attorney-Rep[0].USCISELISAcctNumber[0]": { "type": "text", "source": "attorney.uscis_account_number" }
}'::jsonb
WHERE form_key = 'i-765';
