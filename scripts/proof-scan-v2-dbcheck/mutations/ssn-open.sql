-- TEST ONLY mutation: remove every SSN guard. The "refused" SSN checks must FAIL.
ALTER TABLE public.proof_scan_people      DROP CONSTRAINT proof_scan_people_ssn_encrypted_check;
ALTER TABLE public.proof_scan_people      DROP CONSTRAINT proof_scan_people_ssn_pair;
ALTER TABLE public.proof_scan_suggestions DROP CONSTRAINT proof_scan_suggestions_value_encrypted_check;
ALTER TABLE public.proof_scan_suggestions DROP CONSTRAINT proof_scan_suggestions_ssn_pair;
ALTER TABLE public.proof_scan_suggestions DROP CONSTRAINT proof_scan_suggestions_value_shape;
ALTER TABLE public.proof_scan_suggestions DROP CONSTRAINT proof_scan_suggestions_no_plain_ssn;
ALTER TABLE public.proof_scan_documents   DROP CONSTRAINT proof_scan_documents_no_full_ssn;
