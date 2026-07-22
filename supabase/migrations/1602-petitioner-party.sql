-- Migration 1602: petitioner = the opposing_parties record for immigration matters
--
-- In immigration matters the "Client" is (almost always) the BENEFICIARY, and
-- the second structured person on the matter is the PETITIONER (US-citizen or
-- LPR sponsor filing on the client's behalf), not an adversary. Rather than a
-- new table, we reuse opposing_parties — it already carries the full person
-- record USCIS petitioner blocks need (names, DOB, encrypted SSN, addresses,
-- phones, employer/income for the I-864). The client card relabels the section
-- "Petitioner" for immigration matters (same pattern as the "Party 2"
-- collaborative relabel), and the form filler exposes it as the petitioner.*
-- fill source. Side benefit: petitioners become conflict-checkable, since the
-- conflict checker already searches this table.
--
-- Adds the three petitioner-specific columns the table lacks, then backfills
-- from the legacy free-text jsonb keys in client_immigration.case_data
-- (petitioner_name / petitioner_relationship / petitioner_a_number, captured
-- by the old Family-Based panel) for matters with no opposing_parties row.
-- Legacy jsonb keys are left in place (harmless history); the UI stops
-- offering them.

ALTER TABLE public.opposing_parties
  ADD COLUMN IF NOT EXISTS relationship_to_client text,
  ADD COLUMN IF NOT EXISTS immigration_status text,
  ADD COLUMN IF NOT EXISTS a_number text;

COMMENT ON COLUMN public.opposing_parties.relationship_to_client IS
  'Immigration petitioner: relationship to the client/beneficiary (Spouse, Parent, Child, Sibling, Fiance(e), Other)';
COMMENT ON COLUMN public.opposing_parties.immigration_status IS
  'Immigration petitioner: US Citizen / Lawful Permanent Resident / Other — drives I-130 classification checkboxes';
COMMENT ON COLUMN public.opposing_parties.a_number IS
  'Immigration petitioner: A-number if any (LPR petitioners), display style "A123456789"';

-- Backfill: promote legacy free-text petitioner jsonb into a structured row,
-- only where the matter has petitioner text and no opposing_parties row yet.
-- Name split: last word -> last_name, remainder -> first_name (single-word
-- names land whole in first_name, which is NOT NULL anyway).
INSERT INTO public.opposing_parties
  (matter_id, first_name, last_name, relationship_to_client, a_number)
SELECT
  ci.matter_id,
  COALESCE(
    NULLIF(regexp_replace(trim(ci.case_data->>'petitioner_name'), '\s+\S+$', ''), ''),
    trim(ci.case_data->>'petitioner_name')
  ),
  CASE
    WHEN trim(ci.case_data->>'petitioner_name') ~ '\s'
    THEN regexp_replace(trim(ci.case_data->>'petitioner_name'), '^.*\s', '')
  END,
  NULLIF(trim(ci.case_data->>'petitioner_relationship'), ''),
  NULLIF(trim(ci.case_data->>'petitioner_a_number'), '')
FROM public.client_immigration ci
WHERE COALESCE(trim(ci.case_data->>'petitioner_name'), '') <> ''
  AND NOT EXISTS (
    SELECT 1 FROM public.opposing_parties op WHERE op.matter_id = ci.matter_id
  );
