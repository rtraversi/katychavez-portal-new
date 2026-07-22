-- Migration 1601: client's own USCIS Online Account Number
--
-- The applicant's USCIS online account number (12 digits) had no data column
-- (only the attorney's exists, users.uscis_account_number from 1521), so the
-- N-400 Part 2 #4 and I-765 Part 2 #8 boxes were left deliberately blank in
-- their field maps. Adds client_immigration.uscis_account_number (edited in
-- the client card's Immigration -> General section) and wires both boxes.
-- jsonb || merge, same pattern as 1600-i765-atty-fields.

ALTER TABLE public.client_immigration
  ADD COLUMN IF NOT EXISTS uscis_account_number text;

-- N-400 Part 2 item 4 (maxLen 12)
UPDATE public.form_templates
SET field_map = field_map || '{
  "form1[0].#subform[1].P2_Line6_USCISELISAcctNumber[0]": { "type": "text", "source": "immigration.uscis_account_number", "transform": "digits" }
}'::jsonb
WHERE form_key = 'n-400';

-- I-765 Part 2 item 8 (applicant Elis account; the attorney header box is
-- separate and already maps from attorney.uscis_account_number)
UPDATE public.form_templates
SET field_map = field_map || '{
  "form1[0].Page2[0].Line8_ElisAccountNumber[0]": { "type": "text", "source": "immigration.uscis_account_number", "transform": "digits" }
}'::jsonb
WHERE form_key = 'i-765';
