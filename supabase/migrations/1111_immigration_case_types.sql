-- Migration 1111: Expanded immigration case types
-- Adds common USCIS form-based case types that immigration firms handle regularly.
-- These supplement the baseline immigration types seeded in 007_practice_areas.sql.

INSERT INTO public.case_types (practice_area_id, key, name, sort_order)
SELECT pa.id, ct.key, ct.name, ct.sort_order
FROM public.practice_areas pa
CROSS JOIN (VALUES
  ('unlawful_presence_waiver', 'I-601A Unlawful Presence Waiver',       115),
  ('inadmissibility_waiver',   'I-601 Waiver of Inadmissibility',       120),
  ('remove_conditions',        'Remove Conditions on Residence (I-751)', 125),
  ('green_card_renewal',       'Green Card Renewal / Replacement (I-90)',130),
  ('temporary_protected_status','Temporary Protected Status (TPS)',      135),
  ('advance_parole',           'Advance Parole / Travel Document (I-131)',140),
  ('parole_in_place',          'Parole in Place (PIP)',                  145),
  ('cancellation_of_removal',  'Cancellation of Removal',               150)
) AS ct(key, name, sort_order)
WHERE pa.key = 'immigration'
ON CONFLICT (practice_area_id, key) DO NOTHING;
