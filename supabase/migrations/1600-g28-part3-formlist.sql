-- Migration 1600-g28-part3-formlist: G-28 Part 3 item 1.b ("List the form
-- numbers") now autofills with the package's other form numbers (e.g.
-- "I-821D, I-765, I-765WS, G-1145, G-1450" for DACA Renewal — everything the
-- appearance covers except the G-28 itself).
--
-- New data source "package.form_numbers" is computed per generate in
-- form-filler-generate.js from the matter's package items (sort order,
-- active, non-g-28) — requires the Worker deploy that ships it. The PDF box
-- is maxLength 30; the fill code raises maxLength rather than truncate.

UPDATE public.form_templates
SET field_map = field_map || '{
  "form1[0].#subform[1].Line1b_ListFormNumber[0]": { "type": "text", "source": "package.form_numbers" }
}'::jsonb
WHERE form_key = 'g-28';
