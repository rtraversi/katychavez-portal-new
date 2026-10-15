-- Migration 2005: Proof Scan v2.0.2 (decisions D-111 to D-128 in
-- docs/proof-scan-v2/DECISIONS-MASTER-RECORD.md)
--
-- Apply BEFORE deploying the v2.0.2 code. Depends on 1704 and 2000 to 2004.
-- Idempotent: every step checks first, so a second run changes nothing.
--
-- 1. proof_scan_people.city_of_birth (Q-56): carried on the case card always,
--    compared only for a birth in the US. Suggestions may carry it too.
-- 2. proof_scan_possible_issues.general_rule (D-125): the general rule wording
--    a Possible issue may pre-fill when staff suggest it as a rule. The server
--    stores it only when it carries nothing from the case.
-- 3. form_editions.edition_notices (D-127): what the edition check read from
--    each form's uscis.gov notices: which editions USCIS accepts or rejects,
--    and from or until when. Shape:
--      {"statements": [{"kind": "accept"|"reject"|"only", "edition": "MM/DD/YY",
--                       "from": "YYYY-MM-DD"|null, "until": "YYYY-MM-DD"|null}],
--       "unreadable": ["MM/DD/YY", ...], "text": "the notice clauses"}
-- 4. A new rule-set version for each case type (rule sets are frozen once a
--    run used them, D-60), copied from the CURRENT version so any rulebook
--    edits staff made are kept, with:
--      PS-103 (no blank or duplicate pages) retired: it is raised as a
--             Possible issue instead, never counted (D-123, Q-55)
--      PS-306 (translation needed) noted as not applying to passports (D-124);
--             the server already skips passports for it
--    The new version becomes current. Runs already stored keep the version
--    they ran with. Both changes go to the internal change log.

-- ── 1. City of birth ─────────────────────────────────────────────────────────
ALTER TABLE public.proof_scan_people ADD COLUMN IF NOT EXISTS city_of_birth text;

ALTER TABLE public.proof_scan_suggestions DROP CONSTRAINT IF EXISTS proof_scan_suggestions_field_check;
ALTER TABLE public.proof_scan_suggestions ADD CONSTRAINT proof_scan_suggestions_field_check CHECK (field IN (
  'first_name', 'middle_name', 'last_name',
  'street', 'apt_type', 'apt_number', 'city', 'state', 'zip',
  'in_care_of', 'province', 'postal_code', 'country',
  'date_of_birth', 'a_number', 'ead_expiration',
  'phone', 'email', 'ssn',
  'uscis_account_number', 'country_of_birth', 'country_of_citizenship',
  'i94_number', 'i94_expiration', 'last_entry_date', 'port_of_entry',
  'employer', 'marriage_date', 'marriage_place',
  'city_of_birth'));

-- ── 2. General rule wording on a Possible issue ──────────────────────────────
ALTER TABLE public.proof_scan_possible_issues ADD COLUMN IF NOT EXISTS general_rule text;
ALTER TABLE public.proof_scan_possible_issues DROP CONSTRAINT IF EXISTS proof_scan_possible_issues_general_rule_len;
ALTER TABLE public.proof_scan_possible_issues ADD CONSTRAINT proof_scan_possible_issues_general_rule_len
  CHECK (general_rule IS NULL OR length(general_rule) BETWEEN 1 AND 500);

-- ── 3. USCIS edition notices ─────────────────────────────────────────────────
ALTER TABLE public.form_editions ADD COLUMN IF NOT EXISTS edition_notices jsonb;
ALTER TABLE public.form_editions DROP CONSTRAINT IF EXISTS form_editions_edition_notices_shape;
ALTER TABLE public.form_editions ADD CONSTRAINT form_editions_edition_notices_shape
  CHECK (edition_notices IS NULL OR jsonb_typeof(edition_notices) = 'object');
COMMENT ON COLUMN public.form_editions.edition_notices IS
  'D-127: accepted / rejected editions read from the uscis.gov notices, with their dates. Kept when a later check cannot read the page (D-122).';

-- ── 4. Rule sets: a new version per case type ────────────────────────────────
DO $$
DECLARE
  v_case   text;
  v_old    public.proof_scan_rule_sets%ROWTYPE;
  v_new_id uuid;
  v_rule   public.proof_scan_rules%ROWTYPE;
  v_new_rule uuid;
  v_306_note constant text := 'A document not in English needs a certified English translation in the package. Checked at Physical Scan; at Draft Review and Pre-flight only when evidence is part of the files. Decided by Max 2026-10-08 (D-100). Does not apply to passports, which usually carry their own translation (D-124, 2026-10-13).';
BEGIN
  FOREACH v_case IN ARRAY ARRAY['daca_renewal', 'general'] LOOP
    SELECT * INTO v_old FROM public.proof_scan_rule_sets WHERE case_type = v_case AND is_current;
    IF NOT FOUND THEN CONTINUE; END IF;
    -- Already done: the current version has no live PS-103.
    IF NOT EXISTS (SELECT 1 FROM public.proof_scan_rules
                   WHERE rule_set_id = v_old.id AND rule_id = 'PS-103' AND NOT retired) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.proof_scan_rule_sets (case_type, version, is_current, label, source_note, created_by)
    VALUES (v_case, (SELECT max(version) + 1 FROM public.proof_scan_rule_sets WHERE case_type = v_case),
            false, v_old.label,
            concat_ws(' ', v_old.source_note, 'v2.0.2 (migration 2005): PS-103 moved to Possible issues (D-123); PS-306 does not apply to passports (D-124).'),
            NULL)
    RETURNING id INTO v_new_id;

    INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order)
    SELECT v_new_id, item_id, form, instance, label, pages, kind, sort_order
    FROM public.proof_scan_package_items WHERE rule_set_id = v_old.id;

    FOR v_rule IN SELECT * FROM public.proof_scan_rules WHERE rule_set_id = v_old.id ORDER BY sort_order LOOP
      INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item,
                                           expected, pass_text, note, source_note, applies_to_item_ids,
                                           scope, origin, retired, sort_order)
      VALUES (v_new_id, v_rule.rule_id, v_rule.title, v_rule.severity, v_rule.check_kind, v_rule.form, v_rule.page,
              v_rule.item, v_rule.expected, v_rule.pass_text,
              CASE WHEN v_rule.rule_id = 'PS-306' THEN v_306_note ELSE v_rule.note END,
              v_rule.source_note, v_rule.applies_to_item_ids, v_rule.scope, v_rule.origin,
              v_rule.retired OR v_rule.rule_id = 'PS-103', v_rule.sort_order)
      RETURNING id INTO v_new_rule;

      INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
      SELECT v_new_rule, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no
      FROM public.proof_scan_rule_stage_settings WHERE rule_pk = v_rule.id;
    END LOOP;

    INSERT INTO public.proof_scan_rule_changes (rule_set_id, previous_rule_set_id, rule_id, action, before_value, after_value, changed_by)
    VALUES
      (v_new_id, v_old.id, 'PS-103', 'retire', '{"retired": false}'::jsonb,
       '{"retired": true, "why": "D-123 / Q-55: raised as a Possible issue, never counted"}'::jsonb, NULL),
      (v_new_id, v_old.id, 'PS-306', 'edit',
       jsonb_build_object('note', (SELECT note FROM public.proof_scan_rules WHERE rule_set_id = v_old.id AND rule_id = 'PS-306')),
       jsonb_build_object('note', v_306_note), NULL);

    -- One current version per case type (unique index): old off, then new on.
    UPDATE public.proof_scan_rule_sets SET is_current = false WHERE id = v_old.id;
    UPDATE public.proof_scan_rule_sets SET is_current = true  WHERE id = v_new_id;
  END LOOP;
END;
$$;
