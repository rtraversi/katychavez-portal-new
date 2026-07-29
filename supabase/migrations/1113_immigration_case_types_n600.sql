-- Migration 1113: N-600 Certificate of Citizenship case type
--
-- Surfaced while mapping a live immigration board to the portal: a real matter carried
-- the case code N-600, which had no portal equivalent and so could not be assigned a
-- case type at all.
--
-- Supplements 007_practice_areas.sql and 1111_immigration_case_types.sql. Same pattern —
-- case types are rows, not an enum, so the picker updates with no code change.
--
-- Note on I-134: it was tempting to add that alongside this one, but I-134 (Declaration
-- of Financial Support) is a FORM, not a case type — it appears on the board because a
-- form code was typed into the Case column. It belongs on a matter's form list, not in
-- this table.

INSERT INTO public.case_types (practice_area_id, key, name, sort_order)
SELECT pa.id, ct.key, ct.name, ct.sort_order
FROM public.practice_areas pa
CROSS JOIN (VALUES
  ('certificate_of_citizenship', 'Certificate of Citizenship (N-600)', 155)
) AS ct(key, name, sort_order)
WHERE pa.key = 'immigration'
ON CONFLICT (practice_area_id, key) DO NOTHING;
