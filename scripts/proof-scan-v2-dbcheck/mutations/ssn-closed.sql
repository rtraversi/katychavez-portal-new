-- TEST ONLY mutation: refuse every SSN, even well-formed ones. The "accepted"
-- SSN checks must FAIL. NOT VALID so the mutation itself applies.
ALTER TABLE public.proof_scan_people      ADD CONSTRAINT mutation_no_ssn CHECK (ssn_encrypted IS NULL) NOT VALID;
ALTER TABLE public.proof_scan_suggestions ADD CONSTRAINT mutation_no_ssn CHECK (field <> 'ssn') NOT VALID;
ALTER TABLE public.proof_scan_documents   ADD CONSTRAINT mutation_no_ssn CHECK (NOT facts ? 'ssn') NOT VALID;
