-- TEST ONLY mutation: treat every version as in use.
-- "a version no run uses can still be edited" must FAIL.
CREATE OR REPLACE FUNCTION public.proof_scan_rule_set_in_use(p_rule_set_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT true $$;
