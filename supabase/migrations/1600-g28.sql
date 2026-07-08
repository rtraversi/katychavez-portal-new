-- Migration 1600-g28: G-28 field map fixes found by the first real fill dry-run
-- (2026-07-02, sandbox daca test matter).
--
-- Three defects in 1514's map, fixed here via jsonb merge (|| replaces only
-- the listed keys, everything else in the map is untouched):
--
--   1. Pt3Line9_ANumber: the PDF box takes 9 digits (maxLength=9), but
--      client_immigration.a_number is stored displayed-style ("A123456789").
--      New "a_number" transform strips non-digits.
--   2. Line3b/Line12b_AptSteFlrNumber: the small unit box (maxLength=6) only
--      fits the unit *number*; the unit *type* belongs in the Apt/Ste/Flr
--      checkboxes next to it. New "unit_number" transform extracts "400" from
--      "Suite 400"; the six Unit checkboxes now derive from address_line2 via
--      unit_is_apt/unit_is_ste/unit_is_flr.
--      NOTE checkbox index order is NOT visual order — widget x-positions in
--      the PDF prove: Unit[2]=Apt (leftmost), Unit[0]=Ste, Unit[1]=Flr.
--   3. Line6_EMail (attorney email) is authored by USCIS with maxLength=10 —
--      no map change possible; fixed in code (_form-fill.js raises maxLength
--      instead of failing; requires the Worker deploy that ships this).
--
-- Transforms a_number / unit_number / unit_is_* ship in functions/api/_form-fill.js
-- in the same commit — apply this migration together with that deploy.

UPDATE public.form_templates
SET field_map = field_map || '{
  "form1[0].#subform[1].Pt3Line9_ANumber[0]":      { "type": "text", "source": "immigration.a_number", "transform": "a_number" },

  "form1[0].#subform[0].Line3b_AptSteFlrNumber[0]": { "type": "text", "source": "firm.address_line2", "transform": "unit_number" },
  "form1[0].#subform[0].Line3b_Unit[2]":            { "type": "checkbox", "source": "firm.address_line2", "transform": "unit_is_apt" },
  "form1[0].#subform[0].Line3b_Unit[0]":            { "type": "checkbox", "source": "firm.address_line2", "transform": "unit_is_ste" },
  "form1[0].#subform[0].Line3b_Unit[1]":            { "type": "checkbox", "source": "firm.address_line2", "transform": "unit_is_flr" },

  "form1[0].#subform[1].Line12b_AptSteFlrNumber[0]": { "type": "text", "source": "client.address_line2", "transform": "unit_number" },
  "form1[0].#subform[1].Line12b_Unit[2]":            { "type": "checkbox", "source": "client.address_line2", "transform": "unit_is_apt" },
  "form1[0].#subform[1].Line12b_Unit[0]":            { "type": "checkbox", "source": "client.address_line2", "transform": "unit_is_ste" },
  "form1[0].#subform[1].Line12b_Unit[1]":            { "type": "checkbox", "source": "client.address_line2", "transform": "unit_is_flr" }
}'::jsonb
WHERE form_key = 'g-28';
