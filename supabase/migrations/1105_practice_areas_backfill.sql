-- Migration 1105: Backfill practice_area_id and case_type_id on existing matters
-- Maps old case_type text values to the new FK columns added in 007_practice_areas.sql.
-- Safe to run multiple times (WHERE clause skips already-migrated rows).
-- Also enables both practice areas in the sandbox.

-- Enable practice areas for this deployment
INSERT INTO public.enabled_practice_areas (practice_area_key)
  VALUES ('family_law'), ('immigration')
ON CONFLICT DO NOTHING;

-- Backfill matters that have an old case_type text value
UPDATE public.matters m
SET
  case_type_id     = ct.id,
  practice_area_id = ct.practice_area_id
FROM public.case_types ct
WHERE m.case_type = ct.key
  AND (m.case_type_id IS NULL OR m.practice_area_id IS NULL);
