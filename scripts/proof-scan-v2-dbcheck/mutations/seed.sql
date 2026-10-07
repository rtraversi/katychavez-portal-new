-- TEST ONLY mutation: damage the seed. Every seed check must FAIL.
DELETE FROM public.proof_scan_rule_stage_settings
WHERE stage = 'preflight'
  AND rule_pk = (SELECT r.id FROM public.proof_scan_rules r JOIN public.proof_scan_rule_sets rs ON rs.id = r.rule_set_id
                 WHERE rs.case_type = 'daca_renewal' AND r.rule_id = 'PS-101');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, scope, origin, sort_order)
SELECT id, 'DACA-EXTRA-001', 'extra', 'fatal', 'case_type', 'staff_added', 99
FROM public.proof_scan_rule_sets WHERE case_type = 'daca_renewal' AND version = 1;
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, label, pages, sort_order)
SELECT id, 'GEN-EXTRA', 'X', 'extra', 1, 1
FROM public.proof_scan_rule_sets WHERE case_type = 'general' AND version = 1;
UPDATE public.proof_scan_rule_stage_settings SET state = 'later'
WHERE stage = 'physical_scan'
  AND rule_pk = (SELECT r.id FROM public.proof_scan_rules r JOIN public.proof_scan_rule_sets rs ON rs.id = r.rule_set_id
                 WHERE rs.case_type = 'general' AND r.rule_id = 'PS-201');
UPDATE public.proof_scan_rule_sets SET is_current = false WHERE case_type = 'general';
