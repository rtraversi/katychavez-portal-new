-- 2301_matter_additional_case_types.sql
-- A matter can cover more than one case type — an estate plan is usually a bundle
-- (a will AND an irrevocable trust AND powers of attorney).
--
-- matters.case_type_id stays the PRIMARY case type, so every consumer that reads
-- it (form filler, Case Builder packages, trust, booking, monday sync…) is unchanged.
-- additional_case_type_ids holds the rest, chosen under "Also includes" on the New
-- Client form and the card's Case section, and is shown alongside the primary.
--
-- An array rather than a join table: it's display + filtering data with no
-- attributes of its own, and case types are retired (active=false), not deleted —
-- the one hard-delete path (case-builder-case-type.js) checks this column too.
-- Range 2300-2399 = Estate Planning. Idempotent; cherry-picked to client repos.

ALTER TABLE public.matters
  ADD COLUMN IF NOT EXISTS additional_case_type_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS matters_additional_case_type_ids_gin
  ON public.matters USING gin (additional_case_type_ids);

-- ── The rest of the estate-planning case types ───────────────────────────────
-- 2300 seeded seven; these are the remaining keys from the estate branch's 2101,
-- so a firm without 2101 (KCL) gets the full list, and the sandbox (which has
-- 2101) is unchanged.

INSERT INTO public.case_types (practice_area_id, key, name, sort_order)
SELECT pa.id, ct.key, ct.name, ct.sort_order
FROM public.practice_areas pa
CROSS JOIN (VALUES
  ('irrevocable_trust',      'Irrevocable Trust',              40),
  ('asset_protection_trust', 'Asset Protection Trust',         50),
  ('special_needs_trust',    'Special Needs Trust',            60),
  ('charitable_trust',       'Charitable Trust',               70),
  ('trust_funding',          'Trust Funding & Retitling',     100),
  ('business_succession',    'Business Succession Planning',  120),
  ('beneficiary_review',     'Beneficiary Designation Review',130)
) AS ct(key, name, sort_order)
WHERE pa.key = 'estate_planning'
ON CONFLICT (practice_area_id, key) DO NOTHING;

-- Starter templates already installed were scoped to the first seven keys; widen
-- them to every estate case type so they appear for the new ones too.
UPDATE public.draft_templates t
SET case_types = (
  SELECT array_agg(DISTINCT k ORDER BY k)
  FROM unnest(coalesce(t.case_types, '{}') || ARRAY[
    'simple_will','will_testamentary_trust','revocable_living_trust','irrevocable_trust',
    'asset_protection_trust','special_needs_trust','charitable_trust','financial_poa',
    'advance_directive','trust_funding','plan_review','business_succession',
    'beneficiary_review','other']) AS k
)
WHERE t.merge_profile = 'estate_planning';
