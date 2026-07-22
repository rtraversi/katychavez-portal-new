-- Migration 1222: Client self-service intake
-- Lets an invited client fill in opposing party, opposing counsel, children,
-- and financial info themselves after a bare-bones staff intake (first/last/
-- email/case_type). Locks per-matter once the client submits — staff can
-- always edit regardless of lock state.
--
-- Writes go through dedicated client-intake-*.js functions (admin/service-role
-- client + explicit ownership + lock checks), NOT direct RLS INSERT/UPDATE —
-- same pattern as update-client-profile.js. Only SELECT RLS is added here so
-- the client-portal UI can read back what it just saved via the normal
-- Supabase client SDK.
--
-- Field list intentionally excludes SSN and driver's license — those go
-- through the existing encrypted save-ssn/reveal-ssn pathway (migration 402),
-- not plain client self-entry. Revisit once Anita's actual intake forms are
-- in hand — this migration covers the structural/non-sensitive fields only.

ALTER TABLE public.matters
  ADD COLUMN IF NOT EXISTS intake_submitted_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.matters.intake_submitted_at IS
  'Set by client-intake-submit when the client completes self-service intake (opposing party/counsel, children, financial). NULL = still editable by the client. Staff can always edit regardless of this flag.';

-- ── Client SELECT policies (additive — existing staff policies unaffected) ───

CREATE POLICY "opposing_select_client" ON public.opposing_parties FOR SELECT
  USING (
    matter_id IN (
      SELECT id FROM public.matters
      WHERE client_id = public.my_client_id() AND NOT is_dv_confidential
    )
  );

CREATE POLICY "opp_counsel_select_client" ON public.opposing_counsels FOR SELECT
  USING (
    matter_id IN (
      SELECT id FROM public.matters
      WHERE client_id = public.my_client_id() AND NOT is_dv_confidential
    )
  );

CREATE POLICY "children_select_client" ON public.children FOR SELECT
  USING (
    matter_id IN (
      SELECT id FROM public.matters
      WHERE client_id = public.my_client_id() AND NOT is_dv_confidential
    )
  );

CREATE POLICY "financial_select_client" ON public.financial_info FOR SELECT
  USING (
    matter_id IN (
      SELECT id FROM public.matters
      WHERE client_id = public.my_client_id() AND NOT is_dv_confidential
    )
  );
