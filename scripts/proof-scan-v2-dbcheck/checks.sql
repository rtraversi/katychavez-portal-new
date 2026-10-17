-- TEST ONLY. Run by scripts/proof-scan-v2-dbcheck/run.sh against a throwaway
-- local database that already has shim.sql and the migration chain applied.
-- NEVER run against a real database: it creates fake users and synthetic rows.
--
-- Each check records one row in dbcheck.results; run.sh prints them as PASS/FAIL.
-- All data below is synthetic.

\set ON_ERROR_STOP on
SET client_min_messages = warning;

CREATE SCHEMA dbcheck;
CREATE TABLE dbcheck.results (n serial PRIMARY KEY, name text NOT NULL, ok boolean NOT NULL, detail text);
CREATE TABLE dbcheck.ids (k text PRIMARY KEY, v uuid NOT NULL);

CREATE FUNCTION dbcheck.id(p_k text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT v FROM dbcheck.ids WHERE k = p_k;
$$;

CREATE FUNCTION dbcheck.record(p_name text, p_ok boolean, p_detail text DEFAULT NULL) RETURNS void
LANGUAGE sql AS $$
  INSERT INTO dbcheck.results (name, ok, detail) VALUES (p_name, coalesce(p_ok, false), p_detail);
$$;

-- Run one statement as p_role (NULL = the superuser running the checks) with
-- auth.uid() = p_sub, then ALWAYS roll it back. err is the error text (NULL if
-- it ran); n is the selected value for a SELECT, or the row count otherwise.
CREATE FUNCTION dbcheck.attempt(p_sql text, p_role text DEFAULT NULL, p_sub uuid DEFAULT NULL,
                                OUT err text, OUT n bigint)
LANGUAGE plpgsql AS $$
BEGIN
  BEGIN
    PERFORM set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
    IF p_role IS NOT NULL THEN EXECUTE format('SET LOCAL ROLE %I', p_role); END IF;
    IF p_sql ~* '^\s*(select|with)\M' THEN
      EXECUTE p_sql INTO n;
    ELSE
      EXECUTE p_sql;
      GET DIAGNOSTICS n = ROW_COUNT;
    END IF;
    RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'dbcheck rollback';
  EXCEPTION
    WHEN SQLSTATE 'P0999' THEN err := NULL;
    WHEN others THEN err := SQLERRM; n := NULL;
  END;
END;
$$;

-- Fingerprint of everything the seed writes, for the run-twice check.
CREATE FUNCTION dbcheck.seed_fingerprint() RETURNS text LANGUAGE sql STABLE AS $$
  SELECT md5(concat_ws('|',
    (SELECT string_agg(t::text, ',' ORDER BY t::text) FROM public.proof_scan_rule_sets t),
    (SELECT string_agg(t::text, ',' ORDER BY t::text) FROM public.proof_scan_package_items t),
    (SELECT string_agg(t::text, ',' ORDER BY t::text) FROM public.proof_scan_rules t),
    (SELECT string_agg(t::text, ',' ORDER BY t::text) FROM public.proof_scan_rule_stage_settings t)));
$$;

CREATE FUNCTION dbcheck.rule_set(p_case_type text) RETURNS uuid LANGUAGE sql STABLE AS $$
  SELECT id FROM public.proof_scan_rule_sets WHERE case_type = p_case_type AND version = 1;
$$;

-- ═════════════════════════════════════════════════════════════════════════════
-- SEED (before any fixture touches the rule tables)
-- ═════════════════════════════════════════════════════════════════════════════

SELECT dbcheck.record('seed: DACA renewal has 42 rules and 8 package items',
  (SELECT count(*) FROM public.proof_scan_rules WHERE rule_set_id = dbcheck.rule_set('daca_renewal')) = 42
  AND (SELECT count(*) FROM public.proof_scan_package_items WHERE rule_set_id = dbcheck.rule_set('daca_renewal')) = 8,
  format('rules=%s items=%s',
    (SELECT count(*) FROM public.proof_scan_rules WHERE rule_set_id = dbcheck.rule_set('daca_renewal')),
    (SELECT count(*) FROM public.proof_scan_package_items WHERE rule_set_id = dbcheck.rule_set('daca_renewal'))));

SELECT dbcheck.record('seed: General has the 10 firm-wide rules and 0 package items',
  (SELECT array_agg(rule_id ORDER BY rule_id) FROM public.proof_scan_rules WHERE rule_set_id = dbcheck.rule_set('general'))
    = ARRAY['PS-101','PS-102','PS-103','PS-201','PS-301','PS-302','PS-303','PS-304','PS-305','PS-306']
  AND (SELECT count(*) FROM public.proof_scan_package_items WHERE rule_set_id = dbcheck.rule_set('general')) = 0,
  format('rules=%s items=%s',
    (SELECT count(*) FROM public.proof_scan_rules WHERE rule_set_id = dbcheck.rule_set('general')),
    (SELECT count(*) FROM public.proof_scan_package_items WHERE rule_set_id = dbcheck.rule_set('general'))));

SELECT dbcheck.record('seed: every rule has a Draft Review, Pre-flight and Physical Scan setting',
  NOT EXISTS (
    SELECT 1 FROM public.proof_scan_rules r
    WHERE (SELECT array_agg(stage ORDER BY stage) FROM public.proof_scan_rule_stage_settings s WHERE s.rule_pk = r.id)
          IS DISTINCT FROM ARRAY['draft_review','physical_scan','preflight'])
  -- The seed is version 1 of each case type; 2005 adds a copy as version 2.
  AND (SELECT count(*) FROM public.proof_scan_rules WHERE rule_set_id IN (dbcheck.rule_set('daca_renewal'), dbcheck.rule_set('general'))) = 52,
  format('rules without all three: %s',
    (SELECT count(*) FROM public.proof_scan_rules r
     WHERE (SELECT count(*) FROM public.proof_scan_rule_stage_settings s WHERE s.rule_pk = r.id) <> 3)));

SELECT dbcheck.record('seed: every Physical Scan setting is checked',
  NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE stage = 'physical_scan' AND state <> 'checked'));

SELECT dbcheck.record('seed: PS-306 translations: checked at Physical Scan, only with evidence before (D-100)',
  (SELECT array_agg(r.rule_set_id::text || ':' || s.stage || '=' || s.state ORDER BY r.rule_set_id, s.stage) IS NOT NULL
   FROM public.proof_scan_rules r JOIN public.proof_scan_rule_stage_settings s ON s.rule_pk = r.id WHERE r.rule_id = 'PS-306')
  AND (SELECT count(*) FROM public.proof_scan_rules WHERE rule_id = 'PS-306' AND scope = 'firm'
       AND rule_set_id IN (dbcheck.rule_set('daca_renewal'), dbcheck.rule_set('general'))) = 2
  AND NOT EXISTS (SELECT 1 FROM public.proof_scan_rules r JOIN public.proof_scan_rule_stage_settings s ON s.rule_pk = r.id
                  WHERE r.rule_id = 'PS-306' AND s.state <> CASE WHEN s.stage = 'physical_scan' THEN 'checked' ELSE 'if_evidence' END));

SELECT dbcheck.record('cases: a person card holds the D-100 facts, dates as dates',
  (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'proof_scan_people'
     AND column_name IN ('uscis_account_number','country_of_birth','country_of_citizenship','i94_number','i94_expiration',
                         'last_entry_date','port_of_entry','employer','marriage_date','marriage_place')) = 10
  AND (SELECT count(*) FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'proof_scan_people'
     AND column_name IN ('i94_expiration','last_entry_date','marriage_date') AND data_type = 'date') = 3);

-- v2.1: three case types once 2006 has added AOS.
SELECT dbcheck.record('seed: one current rule set per case type',
  (SELECT count(*) FROM public.proof_scan_rule_sets WHERE is_current) = 3
  AND (SELECT count(DISTINCT case_type) FROM public.proof_scan_rule_sets WHERE is_current) = 3);

CREATE TABLE dbcheck.seed_before AS SELECT dbcheck.seed_fingerprint() AS fp;
\ir ../../supabase/migrations/2003_proof_scan_v2_seed.sql
SELECT dbcheck.record('seed: running 2003 a second time changes nothing',
  (SELECT fp FROM dbcheck.seed_before) = dbcheck.seed_fingerprint());

-- ═════════════════════════════════════════════════════════════════════════════
-- FIXTURES (as the superuser, so RLS does not apply). Synthetic only.
-- ═════════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  v_paralegal_auth uuid := gen_random_uuid();
  v_client_auth    uuid := gen_random_uuid();
  v_case uuid; v_case2 uuid; v_person uuid; v_doc uuid; v_run_dr uuid; v_run_pf uuid; v_issue uuid;
BEGIN
  -- Signup trigger (002) creates public.users with the default Paralegal role.
  INSERT INTO auth.users (id, email) VALUES
    (v_paralegal_auth, 'paralegal@example.test'),
    (v_client_auth,    'client@example.test');
  -- A client login: public.users row moved to the Client role (005), plus the
  -- clients link a real client login carries.
  UPDATE public.users SET role_id = (SELECT id FROM public.roles WHERE name = 'Client')
  WHERE auth_id = v_client_auth;
  INSERT INTO dbcheck.ids VALUES ('paralegal_auth', v_paralegal_auth), ('client_auth', v_client_auth);

  INSERT INTO public.proof_scan_config (custom_instructions) VALUES ('synthetic');

  INSERT INTO public.proof_scan_cases (case_type, label) VALUES ('daca_renewal', 'Test Person A') RETURNING id INTO v_case;
  INSERT INTO public.proof_scan_cases (case_type, label) VALUES ('general', 'Test Family B') RETURNING id INTO v_case2;

  INSERT INTO public.proof_scan_people (case_id, role, is_main, first_name, last_name, a_number)
  VALUES (v_case, 'applicant', true, 'Test', 'Person', '000000001') RETURNING id INTO v_person;
  INSERT INTO public.proof_scan_people (case_id, role, is_main, first_name, last_name)
  VALUES (v_case2, 'petitioner', true, 'Test', 'Petitioner');

  INSERT INTO public.proof_scan_documents (case_id, doc_type, read_quality, facts)
  VALUES (v_case, 'ead', 'clear', '{"a_number": "000000001"}') RETURNING id INTO v_doc;
  INSERT INTO public.proof_scan_document_people (document_id, person_id) VALUES (v_doc, v_person);

  INSERT INTO public.proof_scans (filename, status, result_json, result_schema_version, scan_profile,
                                  profile_version, report_state, attention_count, case_id, stage, scope, rule_set_version)
  VALUES ('synthetic-draft.pdf', 'structured', '{}', 1, 'daca_renewal', 1, 'no_issues_found', 0,
          v_case, 'draft_review', 'whole', 1) RETURNING id INTO v_run_dr;
  INSERT INTO public.proof_scans (filename, status, result_json, result_schema_version, scan_profile,
                                  profile_version, report_state, attention_count, case_id, stage, scope, rule_set_version)
  VALUES ('synthetic-preflight.pdf', 'structured', '{}', 1, 'daca_renewal', 1, 'no_issues_found', 0,
          v_case, 'preflight', 'individual', 1) RETURNING id INTO v_run_pf;

  INSERT INTO public.proof_scan_signoffs (case_id, stage, run_id) VALUES (v_case, 'draft_review', v_run_dr);
  INSERT INTO public.proof_scan_suggestions (person_id, field, value, source_label, document_id)
  VALUES (v_person, 'street', '1 Test St', 'EAD', v_doc);
  INSERT INTO public.proof_scan_possible_issues (run_id, title, description, evidence, why_it_matters, uncertainty)
  VALUES (v_run_dr, 't', 'd', 'e', 'w', 'u') RETURNING id INTO v_issue;
  INSERT INTO public.proof_scan_rule_changes (rule_set_id, action, rule_id)
  VALUES (dbcheck.rule_set('general'), 'edit', 'PS-101');
  -- v2.1 (2006): a clear and an answer count, so the staff-only checks see rows.
  INSERT INTO public.proof_scan_clears (case_id, stage, item_key, via) VALUES (v_case, 'draft_review', 'rule:PS-101', 'hand');
  INSERT INTO public.proof_scan_answer_tally (case_type, form, item, topic, no_count) VALUES ('aos', 'I-485', '53.b', 'genocide', 1);

  INSERT INTO dbcheck.ids VALUES ('case', v_case), ('case2', v_case2), ('person', v_person), ('doc', v_doc),
    ('run_dr', v_run_dr), ('run_pf', v_run_pf), ('issue', v_issue);
END;
$$;

CREATE TABLE dbcheck.ps_tables (t text PRIMARY KEY);
INSERT INTO dbcheck.ps_tables VALUES
  ('proof_scans'), ('proof_scan_config'), ('proof_scan_cases'), ('proof_scan_people'),
  ('proof_scan_documents'), ('proof_scan_document_people'), ('proof_scan_suggestions'),
  ('proof_scan_signoffs'), ('proof_scan_possible_issues'), ('proof_scan_suppressions'),
  ('proof_scan_rule_sets'), ('proof_scan_package_items'), ('proof_scan_rules'),
  ('proof_scan_rule_stage_settings'), ('proof_scan_rule_changes'),
  ('proof_scan_clears'), ('proof_scan_answer_tally');

-- ═════════════════════════════════════════════════════════════════════════════
-- SECURITY
-- ═════════════════════════════════════════════════════════════════════════════

-- Pass when the role sees no row in any table: refused, or zero rows.
CREATE FUNCTION dbcheck.leaks(p_role text, p_sub uuid) RETURNS text LANGUAGE plpgsql AS $$
DECLARE r record; a record; out text := '';
BEGIN
  FOR r IN SELECT t FROM dbcheck.ps_tables ORDER BY t LOOP
    a := dbcheck.attempt(format('SELECT count(*) FROM public.%I', r.t), p_role, p_sub);
    IF a.err IS NULL AND a.n > 0 THEN out := out || format('%s(%s rows) ', r.t, a.n); END IF;
  END LOOP;
  RETURN nullif(out, '');
END;
$$;

SELECT dbcheck.record('security: anon sees no row in any Proof Scan table',
  dbcheck.leaks('anon', NULL) IS NULL, dbcheck.leaks('anon', NULL));

SELECT dbcheck.record('security: anon cannot insert, update or delete',
  (dbcheck.attempt($q$INSERT INTO public.proof_scan_cases (case_type, label) VALUES ('general', 'x')$q$, 'anon')).err IS NOT NULL
  AND coalesce((dbcheck.attempt($q$UPDATE public.proof_scan_suppressions SET label = 'x'$q$, 'anon')).n, 0) = 0
  AND coalesce((dbcheck.attempt($q$DELETE FROM public.proof_scans$q$, 'anon')).n, 0) = 0);

SELECT dbcheck.record('security: a Client-role login sees no row in any Proof Scan table',
  dbcheck.leaks('authenticated', dbcheck.id('client_auth')) IS NULL,
  dbcheck.leaks('authenticated', dbcheck.id('client_auth')));

SELECT dbcheck.record('security: a Client-role login cannot insert, update or delete',
  (dbcheck.attempt($q$INSERT INTO public.proof_scan_cases (case_type, label) VALUES ('general', 'x')$q$,
                   'authenticated', dbcheck.id('client_auth'))).err IS NOT NULL
  AND coalesce((dbcheck.attempt($q$UPDATE public.proof_scan_suppressions SET label = 'x'$q$,
                   'authenticated', dbcheck.id('client_auth'))).n, 0) = 0
  AND coalesce((dbcheck.attempt($q$DELETE FROM public.proof_scans$q$,
                   'authenticated', dbcheck.id('client_auth'))).n, 0) = 0);

SELECT dbcheck.record('security: a Paralegal reads every Proof Scan table',
  NOT EXISTS (
    SELECT 1 FROM dbcheck.ps_tables p,
      LATERAL dbcheck.attempt(format('SELECT count(*) FROM public.%I', p.t), 'authenticated', dbcheck.id('paralegal_auth')) a
    WHERE a.err IS NOT NULL OR a.n = 0),
  (SELECT string_agg(p.t || ':' || coalesce(a.err, a.n::text), ' ')
   FROM dbcheck.ps_tables p,
     LATERAL dbcheck.attempt(format('SELECT count(*) FROM public.%I', p.t), 'authenticated', dbcheck.id('paralegal_auth')) a
   WHERE a.err IS NOT NULL OR a.n = 0));

SELECT dbcheck.record('security: a Paralegal can insert, update and delete',
  (dbcheck.attempt($q$INSERT INTO public.proof_scan_cases (case_type, label) VALUES ('general', 'Test C')$q$,
                   'authenticated', dbcheck.id('paralegal_auth'))).n = 1
  AND (dbcheck.attempt($q$UPDATE public.proof_scan_suppressions SET label = 'Edited label'$q$,
                   'authenticated', dbcheck.id('paralegal_auth'))).n = 1
  AND (dbcheck.attempt(format('DELETE FROM public.proof_scan_possible_issues WHERE id = %L', dbcheck.id('issue')),
                   'authenticated', dbcheck.id('paralegal_auth'))).n = 1);

-- ═════════════════════════════════════════════════════════════════════════════
-- RULES
-- ═════════════════════════════════════════════════════════════════════════════

SELECT dbcheck.record('rules: a version used by a run cannot be edited',
  (dbcheck.attempt(format($q$UPDATE public.proof_scan_rules SET title = 'x' WHERE rule_set_id = %L AND rule_id = 'PS-101'$q$,
                          dbcheck.rule_set('daca_renewal')))).err IS NOT NULL
  AND (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, scope, origin, sort_order)
                                VALUES (%L, 'PS-999', 'x', 'fatal', 'firm', 'staff_added', 99)$q$,
                          dbcheck.rule_set('daca_renewal')))).err IS NOT NULL
  AND (dbcheck.attempt(format($q$UPDATE public.proof_scan_rule_stage_settings SET state = 'checked'
                                WHERE rule_pk IN (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = %L)$q$,
                          dbcheck.rule_set('daca_renewal')))).err IS NOT NULL
  AND (dbcheck.attempt(format($q$DELETE FROM public.proof_scan_package_items WHERE rule_set_id = %L$q$,
                          dbcheck.rule_set('daca_renewal')))).err IS NOT NULL
  AND (dbcheck.attempt(format($q$UPDATE public.proof_scan_rule_sets SET label = 'x' WHERE id = %L$q$,
                          dbcheck.rule_set('daca_renewal')))).err IS NOT NULL
  AND (dbcheck.attempt(format($q$DELETE FROM public.proof_scan_rule_sets WHERE id = %L$q$,
                          dbcheck.rule_set('daca_renewal')))).err IS NOT NULL);

SELECT dbcheck.record('rules: a version no run uses can still be edited',
  (dbcheck.attempt(format($q$UPDATE public.proof_scan_rules SET title = 'x' WHERE rule_set_id = %L AND rule_id = 'PS-101'$q$,
                          dbcheck.rule_set('general')))).n = 1);

SELECT dbcheck.record('rules: a run naming a rule-set version that does not exist is rejected',
  (dbcheck.attempt(format($q$INSERT INTO public.proof_scans (filename, status, result_json, result_schema_version, scan_profile,
                                profile_version, report_state, attention_count, case_id, stage, rule_set_version)
                              VALUES ('x.pdf', 'structured', '{}', 1, 'daca_renewal', 1, 'no_issues_found', 0, %L, 'physical_scan', 99)$q$,
                          dbcheck.id('case')))).err IS NOT NULL
  AND (dbcheck.attempt(format($q$INSERT INTO public.proof_scans (filename, status, result_json, result_schema_version, scan_profile,
                                profile_version, report_state, attention_count, case_id, stage, rule_set_version)
                              VALUES ('x.pdf', 'structured', '{}', 1, 'daca_renewal', 1, 'no_issues_found', 0, %L, 'physical_scan', 1)$q$,
                          dbcheck.id('case')))).n = 1);

-- ═════════════════════════════════════════════════════════════════════════════
-- CASES
-- ═════════════════════════════════════════════════════════════════════════════

SELECT dbcheck.record('cases: a DACA case cannot have a second person',
  (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_people (case_id, role) VALUES (%L, 'sponsor')$q$,
                          dbcheck.id('case')))).err IS NOT NULL
  AND (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_people (case_id, role) VALUES (%L, 'beneficiary')$q$,
                          dbcheck.id('case2')))).n = 1);

SELECT dbcheck.record('cases: only one main person per case',
  (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_people (case_id, role, is_main) VALUES (%L, 'beneficiary', true)$q$,
                          dbcheck.id('case2')))).err IS NOT NULL);

SELECT dbcheck.record('cases: the case type cannot be changed (D-77)',
  (dbcheck.attempt(format($q$UPDATE public.proof_scan_cases SET case_type = 'general' WHERE id = %L$q$,
                          dbcheck.id('case')))).err IS NOT NULL
  AND (dbcheck.attempt(format($q$UPDATE public.proof_scan_cases SET label = 'Renamed' WHERE id = %L$q$,
                          dbcheck.id('case')))).n = 1);

SELECT dbcheck.record('cases: scope is refused on Physical Scan',
  (dbcheck.attempt(format($q$INSERT INTO public.proof_scans (filename, status, result_json, result_schema_version, scan_profile,
                                profile_version, report_state, attention_count, case_id, stage, scope, rule_set_version)
                              VALUES ('x.pdf', 'structured', '{}', 1, 'daca_renewal', 1, 'no_issues_found', 0, %L, 'physical_scan', 'whole', 1)$q$,
                          dbcheck.id('case')))).err IS NOT NULL);

SELECT dbcheck.record('cases: a sign-off must point at a run of the same case and stage',
  (dbcheck.attempt(format($q$UPDATE public.proof_scan_signoffs SET run_id = %L WHERE case_id = %L$q$,
                          dbcheck.id('run_pf'), dbcheck.id('case')))).err IS NOT NULL
  AND (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_signoffs (case_id, stage, run_id) VALUES (%L, 'draft_review', %L)$q$,
                          dbcheck.id('case2'), dbcheck.id('run_dr')))).err IS NOT NULL
  AND (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_signoffs (case_id, stage, run_id) VALUES (%L, 'preflight', %L)$q$,
                          dbcheck.id('case'), dbcheck.id('run_pf')))).n = 1);

-- A new run of a stage clears that stage's sign-off (D-75).
CREATE FUNCTION dbcheck.new_run_clears_signoff() RETURNS boolean LANGUAGE plpgsql AS $$
DECLARE v_left bigint; v_other bigint;
BEGIN
  BEGIN
    INSERT INTO public.proof_scan_signoffs (case_id, stage, run_id) VALUES (dbcheck.id('case'), 'preflight', dbcheck.id('run_pf'));
    INSERT INTO public.proof_scans (filename, status, result_json, result_schema_version, scan_profile,
                                    profile_version, report_state, attention_count, case_id, stage, scope, rule_set_version)
    VALUES ('again.pdf', 'structured', '{}', 1, 'daca_renewal', 1, 'no_issues_found', 0,
            dbcheck.id('case'), 'draft_review', 'whole', 1);
    SELECT count(*) INTO v_left  FROM public.proof_scan_signoffs WHERE case_id = dbcheck.id('case') AND stage = 'draft_review';
    SELECT count(*) INTO v_other FROM public.proof_scan_signoffs WHERE case_id = dbcheck.id('case') AND stage = 'preflight';
    RAISE EXCEPTION USING ERRCODE = 'P0999';
  EXCEPTION WHEN SQLSTATE 'P0999' THEN NULL;
  END;
  RETURN v_left = 0 AND v_other = 1;
END;
$$;

SELECT dbcheck.record('cases: a new run clears that stage''s sign-off, and only that one',
  dbcheck.new_run_clears_signoff());

SELECT dbcheck.record('cases: a case with reports cannot be deleted',
  (dbcheck.attempt(format('DELETE FROM public.proof_scan_cases WHERE id = %L', dbcheck.id('case')))).err IS NOT NULL
  AND (dbcheck.attempt(format('DELETE FROM public.proof_scan_cases WHERE id = %L', dbcheck.id('case2')))).n = 1);

-- ═════════════════════════════════════════════════════════════════════════════
-- SSN
-- ═════════════════════════════════════════════════════════════════════════════
-- A well-formed (synthetic) ciphertext in the ssnEncrypt format: iv:tag:ciphertext.
CREATE FUNCTION dbcheck.fake_cipher() RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT repeat('a', 24) || ':' || repeat('b', 32) || ':' || repeat('c', 18);
$$;

SELECT dbcheck.record('ssn: plaintext refused in proof_scan_people.ssn_encrypted',
  (dbcheck.attempt(format($q$UPDATE public.proof_scan_people SET ssn_encrypted = '123456789', ssn_last4 = '6789' WHERE id = %L$q$,
                          dbcheck.id('person')))).err IS NOT NULL
  AND (dbcheck.attempt(format($q$UPDATE public.proof_scan_people SET ssn_encrypted = '123-45-6789', ssn_last4 = '6789' WHERE id = %L$q$,
                          dbcheck.id('person')))).err IS NOT NULL);

SELECT dbcheck.record('ssn: a well-formed encrypted value is accepted on a person',
  (dbcheck.attempt(format($q$UPDATE public.proof_scan_people SET ssn_encrypted = %L, ssn_last4 = '6789' WHERE id = %L$q$,
                          dbcheck.fake_cipher(), dbcheck.id('person')))).n = 1);

SELECT dbcheck.record('ssn: a person''s encrypted SSN needs its last four, and the reverse',
  (dbcheck.attempt(format($q$UPDATE public.proof_scan_people SET ssn_encrypted = %L WHERE id = %L$q$,
                          dbcheck.fake_cipher(), dbcheck.id('person')))).err IS NOT NULL
  AND (dbcheck.attempt(format($q$UPDATE public.proof_scan_people SET ssn_last4 = '6789' WHERE id = %L$q$,
                          dbcheck.id('person')))).err IS NOT NULL);

SELECT dbcheck.record('ssn: a well-formed encrypted SSN suggestion is accepted',
  (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_suggestions (person_id, field, value_encrypted, value_last4, source_label)
                              VALUES (%L, 'ssn', %L, '6789', 'Newer EAD')$q$,
                          dbcheck.id('person'), dbcheck.fake_cipher()))).n = 1);

SELECT dbcheck.record('ssn: plaintext SSN refused in suggestions',
  -- in the plaintext column with field = ssn
  (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_suggestions (person_id, field, value, source_label)
                              VALUES (%L, 'ssn', '123456789', 'Newer EAD')$q$, dbcheck.id('person')))).err IS NOT NULL
  -- in the plaintext column next to a valid encrypted pair
  AND (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_suggestions (person_id, field, value, value_encrypted, value_last4, source_label)
                              VALUES (%L, 'ssn', '123456789', %L, '6789', 'Newer EAD')$q$,
                              dbcheck.id('person'), dbcheck.fake_cipher()))).err IS NOT NULL
  -- in the encrypted column
  AND (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_suggestions (person_id, field, value_encrypted, value_last4, source_label)
                              VALUES (%L, 'ssn', '123456789', '6789', 'Newer EAD')$q$, dbcheck.id('person')))).err IS NOT NULL
  -- SSN-shaped value smuggled under another field
  AND (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_suggestions (person_id, field, value, source_label)
                              VALUES (%L, 'phone', '123-45-6789', 'Newer EAD')$q$, dbcheck.id('person')))).err IS NOT NULL);

SELECT dbcheck.record('ssn: an SSN suggestion without both encrypted value and last four is refused',
  (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_suggestions (person_id, field, value_encrypted, source_label)
                              VALUES (%L, 'ssn', %L, 'Newer EAD')$q$, dbcheck.id('person'), dbcheck.fake_cipher()))).err IS NOT NULL
  AND (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_suggestions (person_id, field, value_last4, source_label)
                              VALUES (%L, 'ssn', '6789', 'Newer EAD')$q$, dbcheck.id('person')))).err IS NOT NULL);

SELECT dbcheck.record('ssn: only an SSN suggestion may carry the encrypted pair',
  (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_suggestions (person_id, field, value, value_encrypted, value_last4, source_label)
                              VALUES (%L, 'street', '1 Test St', %L, '6789', 'Newer EAD')$q$,
                              dbcheck.id('person'), dbcheck.fake_cipher()))).err IS NOT NULL);

SELECT dbcheck.record('ssn: document facts never hold a full SSN, a last four is fine',
  (dbcheck.attempt(format($q$UPDATE public.proof_scan_documents SET facts = '{"ssn": "123-45-6789"}' WHERE id = %L$q$,
                          dbcheck.id('doc')))).err IS NOT NULL
  AND (dbcheck.attempt(format($q$UPDATE public.proof_scan_documents SET facts = '{"ssn": 123456789}' WHERE id = %L$q$,
                          dbcheck.id('doc')))).err IS NOT NULL
  AND (dbcheck.attempt(format($q$UPDATE public.proof_scan_documents SET facts = '{"ssn": "XXX-XX-6789"}' WHERE id = %L$q$,
                          dbcheck.id('doc')))).n = 1);


-- ── v2.0.2 (migration 2005) ──────────────────────────────────────────────────

SELECT dbcheck.record('v2.0.2: each case type has a new current version, v1 kept as it was',
  (SELECT count(*) FROM public.proof_scan_rule_sets WHERE is_current AND version = 2) = 2
  AND (SELECT count(*) FROM public.proof_scan_rule_sets WHERE version = 1 AND NOT is_current) = 2);

SELECT dbcheck.record('v2.0.2: PS-103 is retired in the current versions and live in v1 (D-123)',
  (SELECT bool_and(r.retired) FROM public.proof_scan_rules r
     JOIN public.proof_scan_rule_sets s ON s.id = r.rule_set_id WHERE s.is_current AND r.rule_id = 'PS-103')
  AND (SELECT bool_and(NOT r.retired) FROM public.proof_scan_rules r
     JOIN public.proof_scan_rule_sets s ON s.id = r.rule_set_id WHERE s.version = 1 AND s.case_type <> 'aos' AND r.rule_id = 'PS-103'));

SELECT dbcheck.record('v2.0.2: the new versions copy every rule, stage setting and package item',
  (SELECT bool_and(
     (SELECT count(*) FROM public.proof_scan_rules WHERE rule_set_id = n.id) = (SELECT count(*) FROM public.proof_scan_rules WHERE rule_set_id = o.id)
     AND (SELECT count(*) FROM public.proof_scan_package_items WHERE rule_set_id = n.id) = (SELECT count(*) FROM public.proof_scan_package_items WHERE rule_set_id = o.id)
     AND (SELECT count(*) FROM public.proof_scan_rule_stage_settings x JOIN public.proof_scan_rules r ON r.id = x.rule_pk WHERE r.rule_set_id = n.id)
       = (SELECT count(*) FROM public.proof_scan_rule_stage_settings x JOIN public.proof_scan_rules r ON r.id = x.rule_pk WHERE r.rule_set_id = o.id))
   FROM public.proof_scan_rule_sets n JOIN public.proof_scan_rule_sets o ON o.case_type = n.case_type AND o.version = 1
   WHERE n.version = 2));

SELECT dbcheck.record('v2.0.2: PS-306 notes the passport exception; both changes are logged (D-124)',
  (SELECT bool_and(r.note LIKE '%passports%') FROM public.proof_scan_rules r
     JOIN public.proof_scan_rule_sets s ON s.id = r.rule_set_id WHERE s.is_current AND r.rule_id = 'PS-306')
  AND (SELECT count(*) FROM public.proof_scan_rule_changes WHERE rule_id IN ('PS-103', 'PS-306')) = 4);

CREATE TABLE dbcheck.v202_before AS SELECT dbcheck.seed_fingerprint() AS fp, (SELECT count(*) FROM public.proof_scan_rule_changes) AS changes;
\ir ../../supabase/migrations/2005_proof_scan_v2_0_2.sql
SELECT dbcheck.record('v2.0.2: running 2005 a second time changes nothing',
  (SELECT fp FROM dbcheck.v202_before) = dbcheck.seed_fingerprint()
  AND (SELECT changes FROM dbcheck.v202_before) = (SELECT count(*) FROM public.proof_scan_rule_changes));

SELECT dbcheck.record('v2.0.2: a person card holds a city of birth, and a suggestion may carry one (Q-56)',
  (dbcheck.attempt(format($q$UPDATE public.proof_scan_people SET city_of_birth = 'Raleigh' WHERE id = %L$q$, dbcheck.id('person')))).n = 1
  AND (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_suggestions (person_id, field, value, source_label)
                              VALUES (%L, 'city_of_birth', 'Durham', 'Birth certificate')$q$, dbcheck.id('person')))).err IS NULL
  AND (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_suggestions (person_id, field, value, source_label)
                              VALUES (%L, 'shoe_size', '9', 'Birth certificate')$q$, dbcheck.id('person')))).err IS NOT NULL);

SELECT dbcheck.record('v2.0.2: edition notices must be an object; a general rule is bounded',
  (dbcheck.attempt($q$UPDATE public.form_editions SET edition_notices = '[]'::jsonb WHERE form_number = 'I-765'$q$)).err IS NOT NULL
  AND (dbcheck.attempt($q$UPDATE public.form_editions SET edition_notices = '{"statements": [], "unreadable": []}'::jsonb WHERE form_number = 'I-765'$q$)).n = 1
  AND (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_possible_issues (run_id, title, description, evidence, why_it_matters, uncertainty, general_rule)
                              SELECT id, 't', 'd', 'e', 'w', 'u', '' FROM public.proof_scans WHERE case_id IS NOT NULL LIMIT 1$q$))).err IS NOT NULL
  AND (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_possible_issues (run_id, title, description, evidence, why_it_matters, uncertainty, general_rule)
                              SELECT id, 't', 'd', 'e', 'w', 'u', 'Check the evidence.' FROM public.proof_scans WHERE case_id IS NOT NULL LIMIT 1$q$))).n = 1);


-- ── v2.1 (migration 2006) ────────────────────────────────────────────────────

SELECT dbcheck.record('v2.1: AOS v1 is current, with General''s firm-wide checks, 49 AOS checks and 28 package items',
  (SELECT is_current FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1)
  AND (SELECT count(*) FROM public.proof_scan_rules WHERE rule_set_id = dbcheck.rule_set('aos') AND scope = 'case_type') = 49
  AND (SELECT count(*) FROM public.proof_scan_rules WHERE rule_set_id = dbcheck.rule_set('aos') AND scope = 'firm')
    = (SELECT count(*) FROM public.proof_scan_rules r JOIN public.proof_scan_rule_sets s ON s.id = r.rule_set_id
       WHERE s.case_type = 'general' AND s.is_current AND r.scope = 'firm')
  AND (SELECT count(*) FROM public.proof_scan_package_items WHERE rule_set_id = dbcheck.rule_set('aos')) = 28
  AND (SELECT bool_and(r.retired) FROM public.proof_scan_rules r WHERE r.rule_set_id = dbcheck.rule_set('aos') AND r.rule_id = 'PS-103')
  AND (SELECT count(*) FROM public.proof_scan_rule_stage_settings x JOIN public.proof_scan_rules r ON r.id = x.rule_pk
       WHERE r.rule_set_id = dbcheck.rule_set('aos')) = 3 * (SELECT count(*) FROM public.proof_scan_rules WHERE rule_set_id = dbcheck.rule_set('aos')),
  format('aos rules=%s items=%s',
    (SELECT count(*) FROM public.proof_scan_rules WHERE rule_set_id = dbcheck.rule_set('aos')),
    (SELECT count(*) FROM public.proof_scan_package_items WHERE rule_set_id = dbcheck.rule_set('aos'))));

SELECT dbcheck.record('v2.1: spousal-only, co-sponsor and gentle items are marked (Q-59, Q-72, Q-74)',
  (SELECT applies_when FROM public.proof_scan_package_items WHERE rule_set_id = dbcheck.rule_set('aos') AND item_id = 'AOS-F-I130A') = 'spousal'
  AND (SELECT applies_when FROM public.proof_scan_package_items WHERE rule_set_id = dbcheck.rule_set('aos') AND item_id = 'AOS-E-STATUS-J') = 'joint_sponsor'
  AND (SELECT bool_and(missing_confirm) FROM public.proof_scan_package_items WHERE rule_set_id = dbcheck.rule_set('aos') AND item_id IN ('AOS-E-VISA', 'AOS-E-I94'))
  AND NOT (SELECT bool_or(missing_confirm) FROM public.proof_scan_package_items WHERE item_id NOT IN ('AOS-E-VISA', 'AOS-E-I94'))
  AND (SELECT count(*) FROM public.proof_scan_rules WHERE applies_when IS NOT NULL AND rule_set_id <> dbcheck.rule_set('aos')) = 0);

SELECT dbcheck.record('v2.1: an AOS case needs a kind, no other case type has one, and it is locked (D-131)',
  (dbcheck.attempt($q$INSERT INTO public.proof_scan_cases (case_type, label) VALUES ('aos', 'X')$q$)).err IS NOT NULL
  AND (dbcheck.attempt($q$INSERT INTO public.proof_scan_cases (case_type, label, aos_kind) VALUES ('general', 'X', 'spousal')$q$)).err IS NOT NULL
  AND (dbcheck.attempt($q$INSERT INTO public.proof_scan_cases (case_type, label, aos_kind) VALUES ('aos', 'X', 'cousin')$q$)).err IS NOT NULL
  AND (dbcheck.attempt($q$INSERT INTO public.proof_scan_cases (case_type, label, aos_kind) VALUES ('aos', 'X', 'spousal')$q$)).n = 1
  AND (dbcheck.attempt($q$WITH c AS (INSERT INTO public.proof_scan_cases (case_type, label, aos_kind) VALUES ('aos', 'X', 'spousal') RETURNING id)
                         UPDATE public.proof_scan_cases SET aos_kind = 'child_to_parent' WHERE id = (SELECT id FROM c)$q$)).err IS NOT NULL);

SELECT dbcheck.record('v2.1: applies_when is a closed list; an answer-pattern rule is a valid origin (D-138)',
  (dbcheck.attempt(format($q$UPDATE public.proof_scan_package_items SET applies_when = 'cousin' WHERE rule_set_id = %L AND item_id = 'AOS-E-MC'$q$, dbcheck.rule_set('aos')))).err IS NOT NULL
  AND (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, scope, origin, sort_order)
                              VALUES (%L, 'AOS-ADD-001', 't', 'fatal', 'case_type', 'answer_pattern', 999)$q$, dbcheck.rule_set('aos')))).err IS NULL);

SELECT dbcheck.record('v2.1: one clear per case, stage and item; by hand or by the stage review (D-132, D-139)',
  (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_clears (case_id, stage, item_key, via) VALUES (%L, 'draft_review', 'rule:PS-101', 'review')$q$, dbcheck.id('case')))).err IS NOT NULL
  AND (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_clears (case_id, stage, item_key, via) VALUES (%L, 'preflight', 'rule:PS-101', 'review')$q$, dbcheck.id('case')))).n = 1
  AND (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_clears (case_id, stage, item_key, via) VALUES (%L, 'preflight', 'rule:PS-102', 'robot')$q$, dbcheck.id('case')))).err IS NOT NULL
  AND (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_clears (case_id, stage, item_key, via) VALUES (%L, 'evidence_zero', 'rule:PS-102', 'hand')$q$, dbcheck.id('case')))).err IS NOT NULL);

SELECT dbcheck.record('v2.1: the answer tally holds counts only: no case, run, person or client column (D-138)',
  NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'proof_scan_answer_tally'
              AND (column_name ~ '(case_id|run_id|person|client|scan_id|matter)')));

SELECT dbcheck.record('v2.1: a clear goes with its case',
  (dbcheck.attempt(format($q$WITH d AS (DELETE FROM public.proof_scan_cases WHERE id = %L RETURNING id)
                            SELECT count(*) FROM public.proof_scan_clears WHERE case_id = %L$q$, dbcheck.id('case2'), dbcheck.id('case2')))).err IS NULL);

CREATE TABLE dbcheck.v21_before AS SELECT dbcheck.seed_fingerprint() AS fp;
\ir ../../supabase/migrations/2006_proof_scan_v2_1.sql
SELECT dbcheck.record('v2.1: running 2006 a second time changes nothing',
  (SELECT fp FROM dbcheck.v21_before) = dbcheck.seed_fingerprint());

-- After the second run of 2006: a later run of 2005 narrows the suggestion
-- fields again, so 2005 is never applied after 2006 (DEPLOY-CHECKLIST).
SELECT dbcheck.record('v2.1: a card holds a passport number and expiration; a suggestion may carry them (Q-61)',
  (dbcheck.attempt(format($q$UPDATE public.proof_scan_people SET passport_number = 'G1234567', passport_expiration = '2030-01-01' WHERE id = %L$q$, dbcheck.id('person')))).n = 1
  AND (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_suggestions (person_id, field, value, source_label)
                              VALUES (%L, 'passport_number', 'G7654321', 'Passport')$q$, dbcheck.id('person')))).err IS NULL,
  concat_ws(' / ',
    (dbcheck.attempt(format($q$UPDATE public.proof_scan_people SET passport_number = 'G1234567', passport_expiration = '2030-01-01' WHERE id = %L$q$, dbcheck.id('person')))).err,
    (dbcheck.attempt(format($q$INSERT INTO public.proof_scan_suggestions (person_id, field, value, source_label)
                              VALUES (%L, 'passport_number', 'G7654321', 'Passport')$q$, dbcheck.id('person')))).err));
