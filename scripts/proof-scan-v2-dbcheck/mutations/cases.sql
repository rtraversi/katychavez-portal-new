-- TEST ONLY mutation: remove every case rule. Every cases check must FAIL.
DROP TRIGGER proof_scan_people_daca_single ON public.proof_scan_people;
DROP INDEX public.proof_scan_people_one_main;
DROP TRIGGER proof_scan_cases_lock_type ON public.proof_scan_cases;
ALTER TABLE public.proof_scans DROP CONSTRAINT proof_scans_scope_check;
DROP TRIGGER proof_scan_signoffs_match_run ON public.proof_scan_signoffs;
DROP TRIGGER proof_scans_clear_signoff ON public.proof_scans;
ALTER TABLE public.proof_scans DROP CONSTRAINT proof_scans_case_id_fkey;
ALTER TABLE public.proof_scans ADD CONSTRAINT proof_scans_case_id_fkey
  FOREIGN KEY (case_id) REFERENCES public.proof_scan_cases(id) ON DELETE CASCADE;
