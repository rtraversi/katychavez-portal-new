-- Migration 1223: Client self-service intake — gap fill
--
-- 2026-07-02 review of Anita's "Divorce with Children" form + her separate DV
-- screening questionnaire + Whitney Scroggins' three intake forms found that
-- migration 004 (2026-05-31) already built almost everything these forms need
-- (marriage narrative on matters, previous_marriages, children_other_relationships,
-- expanded children/financial_info, and a conflict_questionnaire table that is a
-- verbatim match for Anita's DV screening form). The actual gap was the client-
-- facing API layer, not the schema — see client-intake-*.js changes alongside
-- this migration.
--
-- This migration only adds the one genuinely new field surfaced by Whitney's
-- forms (Texas residency eligibility) and the client-facing SELECT RLS needed
-- for the two tables (previous_marriages, children_other_relationships) that
-- previously only had staff policies.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS county_residency_90_days boolean;
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS texas_residency_duration text;

COMMENT ON COLUMN public.clients.county_residency_90_days IS
  'Texas divorce filing requires 90+ days residency in the filing county. Self-reported at intake.';
COMMENT ON COLUMN public.clients.texas_residency_duration IS
  'Texas divorce filing requires 6+ months state residency. Free-text duration self-reported at intake (e.g. "3 years").';

-- ── Client SELECT policies for previous_marriages / children_other_relationships ──
-- Same pattern as migration 1222 — scoped to the client's own, non-DV-confidential matter.

CREATE POLICY "prev_marriages_select_client" ON public.previous_marriages FOR SELECT
  USING (
    matter_id IN (
      SELECT id FROM public.matters
      WHERE client_id = public.my_client_id() AND NOT is_dv_confidential
    )
  );

CREATE POLICY "children_other_select_client" ON public.children_other_relationships FOR SELECT
  USING (
    matter_id IN (
      SELECT id FROM public.matters
      WHERE client_id = public.my_client_id() AND NOT is_dv_confidential
    )
  );
