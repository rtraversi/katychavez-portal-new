-- TEST ONLY mutation: undo the staff-only security. Every security check must FAIL.
-- Recreates the 1300 mistake on one table (open policy, anon grant back) and
-- removes two Paralegal policies.
GRANT ALL ON TABLE public.proof_scan_cases TO anon;
CREATE POLICY "mutation_open" ON public.proof_scan_cases FOR ALL USING (true) WITH CHECK (true);
DROP POLICY "proof_scan_rule_sets_staff_read" ON public.proof_scan_rule_sets;
DROP POLICY "proof_scan_suppressions_staff_update" ON public.proof_scan_suppressions;
