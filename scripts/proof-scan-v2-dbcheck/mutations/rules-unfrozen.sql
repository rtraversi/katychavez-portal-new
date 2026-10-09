-- TEST ONLY mutation: remove the version freeze and the run -> rule-set check.
-- "used version cannot be edited" and "nonexistent version rejected" must FAIL.
DROP TRIGGER proof_scan_rule_sets_freeze           ON public.proof_scan_rule_sets;
DROP TRIGGER proof_scan_rules_freeze               ON public.proof_scan_rules;
DROP TRIGGER proof_scan_package_items_freeze       ON public.proof_scan_package_items;
DROP TRIGGER proof_scan_rule_stage_settings_freeze ON public.proof_scan_rule_stage_settings;
DROP TRIGGER proof_scans_check_rule_set            ON public.proof_scans;
