-- Migration 2006: Proof Scan v2.1 (decisions D-129 to D-150, Q-59 to Q-81 in
-- docs/proof-scan-v2/DECISIONS-MASTER-RECORD.md)
--
-- Apply AFTER 2005 and BEFORE deploying the v2.1 code. Depends on 2000 to 2005.
-- Idempotent: every step checks first, so a second run changes nothing.
--
-- 1. The AOS case type (D-129 to D-131). 'aos' is allowed on cases and rule
--    sets. An AOS case stores its kind (spousal, child to parent, parent to
--    child), picked at the start and locked with the case type (D-77).
-- 2. proof_scan_people.passport_number and .passport_expiration (Q-61): the
--    beneficiary's passport is evidence, not truth; only its number and
--    expiration date are checked against the forms. Suggestions may carry them.
-- 3. Rules and package items can apply only when something is true of the case
--    (applies_when): the spousal kind (Q-59), a co-sponsor I-864, an I-864A or an
--    I-131 in the package (Q-70, Q-72), a naturalized petitioner or an earlier
--    marriage ended by divorce (Q-72). A package item can be a gentle confirm
--    when missing (missing_confirm: the US visa and the I-94, Q-74). A rule can
--    come from an answer pattern staff approved (origin 'answer_pattern', D-138).
-- 4. proof_scan_clears (D-132, D-139, D-143): staff clear an item by hand, or by
--    marking the stage reviewed. Per case, stage and item; who and when are kept
--    but never shown. A re-run that finds the same item keeps it cleared.
-- 5. proof_scan_answer_tally (D-138): how often each yes/no question on the AOS
--    forms was answered No or Yes. COUNTS ONLY: there is no case, run, person or
--    answer-by-client column, by design (criminal and security answers).
-- 6. The AOS rule set, version 1: the firm-wide checks of the General case
--    type's current version, then the AOS checks and package items. Generated
--    from functions/api/proof-scan-profiles/v2-aos-seed.json by
--    scripts/proof-scan-v2-aos-seed.mjs; do not edit that block by hand.

-- ── 1. The AOS case type ─────────────────────────────────────────────────────
ALTER TABLE public.proof_scan_cases DROP CONSTRAINT IF EXISTS proof_scan_cases_case_type_check;
ALTER TABLE public.proof_scan_cases ADD CONSTRAINT proof_scan_cases_case_type_check
  CHECK (case_type IN ('daca_renewal', 'general', 'aos'));
ALTER TABLE public.proof_scan_rule_sets DROP CONSTRAINT IF EXISTS proof_scan_rule_sets_case_type_check;
ALTER TABLE public.proof_scan_rule_sets ADD CONSTRAINT proof_scan_rule_sets_case_type_check
  CHECK (case_type IN ('daca_renewal', 'general', 'aos'));

ALTER TABLE public.proof_scan_cases ADD COLUMN IF NOT EXISTS aos_kind text;
ALTER TABLE public.proof_scan_cases DROP CONSTRAINT IF EXISTS proof_scan_cases_aos_kind_check;
ALTER TABLE public.proof_scan_cases ADD CONSTRAINT proof_scan_cases_aos_kind_check
  CHECK (aos_kind IS NULL OR aos_kind IN ('spousal', 'child_to_parent', 'parent_to_child'));
-- Every AOS case has a kind; no other case type has one.
ALTER TABLE public.proof_scan_cases DROP CONSTRAINT IF EXISTS proof_scan_cases_aos_kind_shape;
ALTER TABLE public.proof_scan_cases ADD CONSTRAINT proof_scan_cases_aos_kind_shape
  CHECK ((case_type = 'aos') = (aos_kind IS NOT NULL));
COMMENT ON COLUMN public.proof_scan_cases.aos_kind IS
  'D-131: spousal, child_to_parent or parent_to_child, picked when an AOS case starts. Only switches the spousal-only items (Q-59). Locked with the case type.';

-- D-77 and D-131: the case type and the AOS kind are locked once the case starts.
CREATE OR REPLACE FUNCTION public.proof_scan_cases_lock_type()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.case_type IS DISTINCT FROM OLD.case_type THEN
    RAISE EXCEPTION 'The case type of a Proof Scan case cannot be changed once it starts'
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.aos_kind IS DISTINCT FROM OLD.aos_kind THEN
    RAISE EXCEPTION 'The kind of an AOS case cannot be changed once it starts'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;

-- ── 2. Passport number and expiration on the case card ───────────────────────
ALTER TABLE public.proof_scan_people ADD COLUMN IF NOT EXISTS passport_number text;
ALTER TABLE public.proof_scan_people ADD COLUMN IF NOT EXISTS passport_expiration date;

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
  'city_of_birth',
  'passport_number', 'passport_expiration'));

-- ── 3. Conditional rules and package items ───────────────────────────────────
-- Adding a column with a constant default rewrites no row, so the 2002 freeze
-- triggers do not fire and versions already used by a stored run stay intact.
ALTER TABLE public.proof_scan_rules ADD COLUMN IF NOT EXISTS applies_when text;
ALTER TABLE public.proof_scan_rules DROP CONSTRAINT IF EXISTS proof_scan_rules_applies_when_check;
ALTER TABLE public.proof_scan_rules ADD CONSTRAINT proof_scan_rules_applies_when_check
  CHECK (applies_when IS NULL OR applies_when IN
         ('spousal', 'joint_sponsor', 'household_member', 'i131', 'naturalized', 'divorce'));

ALTER TABLE public.proof_scan_package_items ADD COLUMN IF NOT EXISTS applies_when text;
ALTER TABLE public.proof_scan_package_items DROP CONSTRAINT IF EXISTS proof_scan_package_items_applies_when_check;
ALTER TABLE public.proof_scan_package_items ADD CONSTRAINT proof_scan_package_items_applies_when_check
  CHECK (applies_when IS NULL OR applies_when IN
         ('spousal', 'joint_sponsor', 'household_member', 'i131', 'naturalized', 'divorce'));
ALTER TABLE public.proof_scan_package_items ADD COLUMN IF NOT EXISTS missing_confirm boolean NOT NULL DEFAULT false;

ALTER TABLE public.proof_scan_rules DROP CONSTRAINT IF EXISTS proof_scan_rules_origin_check;
ALTER TABLE public.proof_scan_rules ADD CONSTRAINT proof_scan_rules_origin_check
  CHECK (origin IN ('firm_checklist', 'general_rules', 'staff_added', 'possible_issue', 'answer_pattern'));

-- ── 4. Clears ────────────────────────────────────────────────────────────────
-- item_key is the server's stable key for an item in a stage's report
-- ("rule:AOS-485-002", "fact:beneficiary:date_of_birth:3f2a91c0", ...). A fact's
-- key carries a hash of the values, never the values themselves.
CREATE TABLE IF NOT EXISTS public.proof_scan_clears (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid        NOT NULL REFERENCES public.proof_scan_cases(id) ON DELETE CASCADE,
  stage       text        NOT NULL CHECK (stage IN ('draft_review', 'preflight', 'physical_scan')),
  item_key    text        NOT NULL CHECK (length(item_key) BETWEEN 1 AND 300),
  -- 'hand': one click on the item; 'review': "Mark this stage reviewed" (D-139),
  -- taken back when the stage is unmarked or run again.
  via         text        NOT NULL CHECK (via IN ('hand', 'review')),
  cleared_by  uuid        REFERENCES public.users(id) ON DELETE SET NULL DEFAULT public.my_user_id(),
  cleared_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_id, stage, item_key)
);
CREATE INDEX IF NOT EXISTS proof_scan_clears_case_idx ON public.proof_scan_clears (case_id, stage);

ALTER TABLE public.proof_scan_clears ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.proof_scan_clears FROM anon;
DROP POLICY IF EXISTS "proof_scan_clears_staff_read" ON public.proof_scan_clears;
DROP POLICY IF EXISTS "proof_scan_clears_staff_insert" ON public.proof_scan_clears;
DROP POLICY IF EXISTS "proof_scan_clears_staff_update" ON public.proof_scan_clears;
DROP POLICY IF EXISTS "proof_scan_clears_staff_delete" ON public.proof_scan_clears;
CREATE POLICY "proof_scan_clears_staff_read" ON public.proof_scan_clears
  FOR SELECT TO authenticated USING (public.can_read('proof_scan'));
CREATE POLICY "proof_scan_clears_staff_insert" ON public.proof_scan_clears
  FOR INSERT TO authenticated WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_clears_staff_update" ON public.proof_scan_clears
  FOR UPDATE TO authenticated USING (public.can_write('proof_scan')) WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_clears_staff_delete" ON public.proof_scan_clears
  FOR DELETE TO authenticated USING (public.can_write('proof_scan'));

-- ── 5. Answer-pattern tally ──────────────────────────────────────────────────
-- One row per case type, form and question number. Never which client, case or
-- run gave which answer. A question answered No on at least 5 scans, and Yes
-- on at most 1 in 10 answers, becomes 'suggested' (D-150); staff approve (a rule
-- is added) or decline. A Yes does not withdraw a suggestion (D-149).
CREATE TABLE IF NOT EXISTS public.proof_scan_answer_tally (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_type         text        NOT NULL CHECK (case_type IN ('daca_renewal', 'general', 'aos')),
  form              text        NOT NULL CHECK (length(btrim(form)) BETWEEN 1 AND 20),
  item              text        NOT NULL CHECK (length(btrim(item)) BETWEEN 1 AND 20),
  topic             text        NOT NULL CHECK (length(btrim(topic)) BETWEEN 1 AND 120),
  no_count          integer     NOT NULL DEFAULT 0 CHECK (no_count >= 0),
  yes_count         integer     NOT NULL DEFAULT 0 CHECK (yes_count >= 0),
  state             text        NOT NULL DEFAULT 'watching'
                                CHECK (state IN ('watching', 'suggested', 'approved', 'declined')),
  approved_rule_id  text,
  decided_by        uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  decided_at        timestamptz,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (case_type, form, item)
);

ALTER TABLE public.proof_scan_answer_tally ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.proof_scan_answer_tally FROM anon;
DROP POLICY IF EXISTS "proof_scan_answer_tally_staff_read" ON public.proof_scan_answer_tally;
DROP POLICY IF EXISTS "proof_scan_answer_tally_staff_insert" ON public.proof_scan_answer_tally;
DROP POLICY IF EXISTS "proof_scan_answer_tally_staff_update" ON public.proof_scan_answer_tally;
DROP POLICY IF EXISTS "proof_scan_answer_tally_staff_delete" ON public.proof_scan_answer_tally;
CREATE POLICY "proof_scan_answer_tally_staff_read" ON public.proof_scan_answer_tally
  FOR SELECT TO authenticated USING (public.can_read('proof_scan'));
CREATE POLICY "proof_scan_answer_tally_staff_insert" ON public.proof_scan_answer_tally
  FOR INSERT TO authenticated WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_answer_tally_staff_update" ON public.proof_scan_answer_tally
  FOR UPDATE TO authenticated USING (public.can_write('proof_scan')) WITH CHECK (public.can_write('proof_scan'));
CREATE POLICY "proof_scan_answer_tally_staff_delete" ON public.proof_scan_answer_tally
  FOR DELETE TO authenticated USING (public.can_write('proof_scan'));

-- ── 6. The AOS rule set ──────────────────────────────────────────────────────
-- ── BEGIN GENERATED: AOS rule set (scripts/proof-scan-v2-aos-seed.mjs) ──

-- Adjustment of Status v1: the firm-wide checks of General's current version, then
-- 48 AOS checks and 28 package items.
INSERT INTO public.proof_scan_rule_sets (case_type, version, is_current, label, source_note, created_by)
SELECT 'aos', 1,
       NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND is_current),
       'Adjustment of Status', 'The firm''s AOS checklist (D-129 to D-147, Q-59 to Q-81), seeded by migration 2006 with the firm-wide checks of the General case type.', NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1);

INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-F-G1450-I130', 'G-1450', 'I-130 fee', 'Card (G-1450) or bank (G-1650) payment of the I-130 fee', 1, 'form', 1,
       NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-F-G1450-I130');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-F-G1450-I485', 'G-1450', 'I-485 fee', 'Card (G-1450) or bank (G-1650) payment of the I-485 fee', 1, 'form', 2,
       NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-F-G1450-I485');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-F-G1450-I765', 'G-1450', 'I-765 fee', 'Card (G-1450) or bank (G-1650) payment of the I-765 fee', 1, 'form', 3,
       NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-F-G1450-I765');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-F-G1450-I131', 'G-1450', 'I-131 fee', 'Card (G-1450) or bank (G-1650) payment of the I-131 fee, when an I-131 is filed', 1, 'form', 4,
       'i131', false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-F-G1450-I131');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-F-G1145', 'G-1145', NULL, 'E-notification', 1, 'form', 5,
       NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-F-G1145');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-F-G28-PET', 'G-28', 'for the I-130', 'Notice of entry of appearance, the petitioner''s', 4, 'form', 6,
       NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-F-G28-PET');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-F-G28-APP', 'G-28', 'for the I-485 and I-765', 'Notice of entry of appearance, the applicant''s', 4, 'form', 7,
       NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-F-G28-APP');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-F-I130', 'I-130', NULL, 'Petition for alien relative', 12, 'form', 8,
       NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-F-I130');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-F-I130A', 'I-130A', NULL, 'Supplemental information for spouse beneficiary (spousal cases)', 6, 'form', 9,
       'spousal', false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-F-I130A');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-F-I485', 'I-485', NULL, 'Application to adjust status', 24, 'form', 10,
       NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-F-I485');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-F-I765', 'I-765', NULL, 'Application for employment authorization', 7, 'form', 11,
       NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-F-I765');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-F-I864', 'I-864', 'petitioner', 'Affidavit of support, the petitioner''s', 12, 'form', 12,
       NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-F-I864');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-E-BC-BEN', 'Evidence', NULL, 'Beneficiary''s birth certificate', 1, 'evidence', 13,
       NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-E-BC-BEN');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-E-BC-PET', 'Evidence', NULL, 'Petitioner''s birth certificate', 1, 'evidence', 14,
       NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-E-BC-PET');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-E-NATZ-PET', 'Evidence', NULL, 'Petitioner''s naturalization certificate (when the I-130 says the petitioner naturalized)', 1, 'evidence', 15,
       'naturalized', false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-E-NATZ-PET');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-E-MC', 'Evidence', NULL, 'Marriage certificate (spousal cases)', 1, 'evidence', 16,
       'spousal', false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-E-MC');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-E-DIV', 'Evidence', NULL, 'Divorce certificate (when the I-130 or I-130A lists an earlier marriage ended by divorce)', 1, 'evidence', 17,
       'divorce', false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-E-DIV');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-E-PASSPORT', 'Evidence', NULL, 'Beneficiary''s passport photo page', 1, 'evidence', 18,
       NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-E-PASSPORT');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-E-VISA', 'Evidence', NULL, 'Beneficiary''s U.S. visa', 1, 'evidence', 19,
       NULL, true
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-E-VISA');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-E-I94', 'Evidence', NULL, 'Beneficiary''s I-94', 1, 'evidence', 20,
       NULL, true
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-E-I94');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-E-TAX-PET', 'Evidence', NULL, 'Petitioner''s most recent tax return', 1, 'evidence', 21,
       NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-E-TAX-PET');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-E-W2-PET', 'Evidence', NULL, 'Petitioner''s W-2', 1, 'evidence', 22,
       NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-E-W2-PET');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-E-PAY-PET', 'Evidence', NULL, 'Petitioner''s pay stubs or employer letter', 1, 'evidence', 23,
       NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-E-PAY-PET');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-E-TAX-J', 'Evidence', NULL, 'Co-sponsor''s most recent tax return', 1, 'evidence', 24,
       'joint_sponsor', false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-E-TAX-J');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-E-W2-J', 'Evidence', NULL, 'Co-sponsor''s W-2', 1, 'evidence', 25,
       'joint_sponsor', false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-E-W2-J');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-E-PAY-J', 'Evidence', NULL, 'Co-sponsor''s pay stubs or employer letter', 1, 'evidence', 26,
       'joint_sponsor', false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-E-PAY-J');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-E-STATUS-J', 'Evidence', NULL, 'Co-sponsor''s proof of U.S. citizenship or permanent residence', 1, 'evidence', 27,
       'joint_sponsor', false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-E-STATUS-J');
INSERT INTO public.proof_scan_package_items (rule_set_id, item_id, form, instance, label, pages, kind, sort_order, applies_when, missing_confirm)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-E-I693', 'Evidence', NULL, 'Medical exam: the first page of the I-693 (Physical Scan only; one page is complete)', 1, 'evidence', 28,
       NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_package_items WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND item_id = 'AOS-E-I693');

-- Firm-wide checks (D-93), copied from the General case type's current version.
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1), r.rule_id, r.title, r.severity, r.check_kind, r.form, r.page, r.item, r.expected,
       r.pass_text, r.note, r.source_note, r.applies_to_item_ids, r.scope, r.origin, r.retired, r.sort_order
FROM public.proof_scan_rules r
JOIN public.proof_scan_rule_sets s ON s.id = r.rule_set_id
WHERE s.case_type = 'general' AND s.is_current AND r.scope = 'firm'
  AND NOT EXISTS (SELECT 1 FROM public.proof_scan_rules x WHERE x.rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND x.rule_id = r.rule_id);
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT a.id, ss.stage, ss.state, ss.stage_title, ss.stage_pass_text, ss.stage_expected, ss.gentle_if_no
FROM public.proof_scan_rules a
JOIN public.proof_scan_rule_sets gs ON gs.case_type = 'general' AND gs.is_current
JOIN public.proof_scan_rules g ON g.rule_set_id = gs.id AND g.rule_id = a.rule_id
JOIN public.proof_scan_rule_stage_settings ss ON ss.rule_pk = g.id
WHERE a.rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND a.scope = 'firm'
  AND NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings x WHERE x.rule_pk = a.id AND x.stage = ss.stage);

INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-FEE-I130', 'I-130 fee: $675, in the petitioner''s name.', 'fatal', 'pdf',
       'G-1450', '1', NULL, '$675',
       'I-130 fee: $675, in the petitioner''s name.', 'Paid by G-1450, or by G-1650 if the client asks; a G-1650 is not an error (Q-63). The cardholder can be anyone (D-134). The amount is the firm''s and can be corrected here.', NULL, ARRAY['AOS-F-G1450-I130']::text[],
       'case_type', 'firm_checklist', false, 100, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I130');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I130'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I130') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I130'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I130') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I130'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I130') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-FEE-I485', 'I-485 fee matches the applicant''s age, in the applicant''s name.', 'fatal', 'pdf',
       'G-1450', '1', NULL, 'under 14: $950 · 14 to 78: $1,440 · 79 and older: $1,140',
       'I-485 fee matches the applicant''s age.', 'Q-64: age from the birth certificate or case card date of birth only; when that is not settled the fee is not checked. Within a month of turning 14 or 79 a gentle confirm. Under 14, only that an I-485 fee payment is there. Amounts are the firm''s and can be corrected here, in this format.', NULL, ARRAY['AOS-F-G1450-I485']::text[],
       'case_type', 'firm_checklist', false, 101, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I485');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I485'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I485') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I485'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I485') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I485'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I485') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-FEE-I765', 'I-765 fee: $260, in the applicant''s name.', 'fatal', 'pdf',
       'G-1450', '1', NULL, '$260',
       'I-765 fee: $260, in the applicant''s name.', NULL, NULL, ARRAY['AOS-F-G1450-I765']::text[],
       'case_type', 'firm_checklist', false, 102, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I765');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I765'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I765') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I765'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I765') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I765'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I765') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-FEE-I131', 'I-131 fee: $630, in the applicant''s name.', 'fatal', 'pdf',
       'G-1450', '1', NULL, '$630',
       'I-131 fee: $630, in the applicant''s name.', 'Only when an I-131 is filed (Q-70).', NULL, ARRAY['AOS-F-G1450-I131']::text[],
       'case_type', 'firm_checklist', false, 103, 'i131'
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I131');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I131'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I131') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I131'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I131') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I131'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-FEE-I131') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-G1450-CARD', 'Card number, card type, expiration date, cardholder name and billing address are complete on every G-1450.', 'fatal', 'pdf',
       'G-1450', '1', NULL, NULL,
       'Card details complete.', 'The cardholder can be anyone; a name that looks like a misspelling of someone on the case is a gentle confirm (D-134).', NULL, '{}'::text[],
       'case_type', 'firm_checklist', false, 104, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1450-CARD');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1450-CARD'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1450-CARD') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1450-CARD'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1450-CARD') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1450-CARD'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1450-CARD') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-G1450-SIGN', 'Every G-1450 is signed by the cardholder.', 'fatal', 'pdf',
       'G-1450', '1', NULL, NULL,
       'Signed by the cardholder.', 'Q-78. The G-1450 has no date beside the signature.', NULL, '{}'::text[],
       'case_type', 'firm_checklist', false, 105, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1450-SIGN');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1450-SIGN'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1450-SIGN') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1450-SIGN'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1450-SIGN') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1450-SIGN'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1450-SIGN') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-G1450-CONTACT', 'The G-1450s'' email and phone agree with each other and belong to the petitioner or the beneficiary.', 'fatal', 'pdf',
       'G-1450', '1', NULL, NULL,
       'Email and phone agree and belong to someone on the case.', 'Q-79: the petitioner may pay the beneficiary''s fees and the beneficiary the petitioner''s.', NULL, '{}'::text[],
       'case_type', 'firm_checklist', false, 106, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1450-CONTACT');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1450-CONTACT'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1450-CONTACT') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1450-CONTACT'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1450-CONTACT') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1450-CONTACT'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1450-CONTACT') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-G1145-001', 'Petitioner''s name, email and phone.', 'fatal', 'pdf',
       'G-1145', '1', NULL, NULL,
       'Petitioner''s name, email and phone.', 'The G-1145 is under the petitioner''s information and is compared with the petitioner''s case card (Q-66).', NULL, ARRAY['AOS-F-G1145']::text[],
       'case_type', 'firm_checklist', false, 107, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1145-001');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1145-001'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1145-001') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1145-001'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1145-001') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1145-001'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G1145-001') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-G28P-001', 'Petitioner''s G-28 (for the I-130): the petitioner''s name, and the Petitioner box ticked.', 'fatal', 'pdf',
       'G-28', '2', NULL, NULL,
       'Petitioner''s G-28 (for the I-130): the petitioner''s name, and the Petitioner box ticked.', NULL, NULL, ARRAY['AOS-F-G28-PET']::text[],
       'case_type', 'firm_checklist', false, 108, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28P-001');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28P-001'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28P-001') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28P-001'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28P-001') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28P-001'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28P-001') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-G28P-002', 'Petitioner''s G-28: the form-number box lists the I-130.', 'fatal', 'pdf',
       'G-28', '2', '1.b', 'I-130',
       'Petitioner''s G-28: the form-number box lists the I-130.', NULL, NULL, ARRAY['AOS-F-G28-PET']::text[],
       'case_type', 'firm_checklist', false, 109, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28P-002');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28P-002'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28P-002') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28P-002'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28P-002') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28P-002'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28P-002') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-G28P-003', 'Petitioner''s G-28: petitioner and attorney signatures, signed and dated.', 'fatal', 'pdf',
       'G-28', '3', NULL, NULL,
       'Petitioner''s G-28: petitioner and attorney signatures, signed and dated.', NULL, NULL, ARRAY['AOS-F-G28-PET']::text[],
       'case_type', 'firm_checklist', false, 110, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28P-003');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28P-003'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28P-003') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28P-003'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28P-003') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28P-003'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28P-003') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-G28A-001', 'Applicant''s G-28 (for the I-485 and I-765): the applicant''s name, the Applicant box ticked, and the applicant''s address.', 'fatal', 'pdf',
       'G-28', '2', NULL, NULL,
       'Applicant''s G-28 (for the I-485 and I-765): the applicant''s name, the Applicant box ticked, and the applicant''s address.', NULL, NULL, ARRAY['AOS-F-G28-APP']::text[],
       'case_type', 'firm_checklist', false, 111, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-001');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-001'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-001') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-001'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-001') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-001'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-001') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-G28A-002', 'Applicant''s G-28: the form-number box lists the I-485 and the I-765, and the I-131 when one is filed.', 'fatal', 'pdf',
       'G-28', '2', '1.b', 'I-485 and I-765 (and I-131 when filed)',
       'Applicant''s G-28: the form-number box lists the I-485 and the I-765, and the I-131 when one is filed.', NULL, NULL, ARRAY['AOS-F-G28-APP']::text[],
       'case_type', 'firm_checklist', false, 112, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-002');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-002'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-002') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-002'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-002') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-002'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-002') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-G28A-003', 'Applicant''s G-28: where the card is delivered.', 'fatal', 'pdf',
       'G-28', '3', 'Part 4, 1.a-1.c', NULL,
       'Card delivered home.', 'D-107: all delivery boxes empty means home, which is fine; the office box ticked is a gentle confirm, never counted.', NULL, ARRAY['AOS-F-G28-APP']::text[],
       'case_type', 'firm_checklist', false, 113, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-003');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-003'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-003') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-003'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-003') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-003'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-003') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-G28A-004', 'Applicant''s G-28: applicant and attorney signatures, signed and dated.', 'fatal', 'pdf',
       'G-28', '3', NULL, NULL,
       'Applicant''s G-28: applicant and attorney signatures, signed and dated.', NULL, NULL, ARRAY['AOS-F-G28-APP']::text[],
       'case_type', 'firm_checklist', false, 114, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-004');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-004'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-004') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-004'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-004') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-004'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-G28A-004') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-130-001', 'Petitioner''s name (page 1), date of birth and address (page 2).', 'fatal', 'pdf',
       'I-130', '1-2', NULL, NULL,
       'Petitioner''s name (page 1), date of birth and address (page 2).', NULL, NULL, ARRAY['AOS-F-I130']::text[],
       'case_type', 'firm_checklist', false, 115, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-001');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-001'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-001') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-001'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-001') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-001'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-001') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-130-002', 'Beneficiary''s name, date of birth and address.', 'fatal', 'pdf',
       'I-130', '5', NULL, NULL,
       'Beneficiary''s name, date of birth and address.', NULL, NULL, ARRAY['AOS-F-I130']::text[],
       'case_type', 'firm_checklist', false, 116, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-002');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-002'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-002') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-002'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-002') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-002'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-002') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-130-003', 'Petitioner''s signature, signed and dated.', 'fatal', 'pdf',
       'I-130', '9', '6.a', NULL,
       'Petitioner''s signature, signed and dated.', NULL, NULL, ARRAY['AOS-F-I130']::text[],
       'case_type', 'firm_checklist', false, 117, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-003');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-003'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-003') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-003'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-003') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-003'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-003') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-130-004', 'Katy''s signature (preparer), signed and dated.', 'fatal', 'pdf',
       'I-130', '11', '8.a', NULL,
       'Katy''s signature (preparer), signed and dated.', NULL, NULL, ARRAY['AOS-F-I130']::text[],
       'case_type', 'firm_checklist', false, 118, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-004');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-004'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-004') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-004'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-004') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-004'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130-004') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-130A-001', 'Spouse beneficiary''s name and address.', 'fatal', 'pdf',
       'I-130A', '1', NULL, NULL,
       'Spouse beneficiary''s name and address.', NULL, NULL, ARRAY['AOS-F-I130A']::text[],
       'case_type', 'firm_checklist', false, 119, 'spousal'
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-001');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-001'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-001') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-001'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-001') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-001'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-001') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-130A-002', 'Beneficiary''s signature, signed and dated.', 'fatal', 'pdf',
       'I-130A', '3', '6.a', NULL,
       'Beneficiary''s signature, signed and dated.', NULL, NULL, ARRAY['AOS-F-I130A']::text[],
       'case_type', 'firm_checklist', false, 120, 'spousal'
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-002');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-002'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-002') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-002'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-002') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-002'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-002') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-130A-003', 'Katy''s signature (preparer), signed and dated.', 'fatal', 'pdf',
       'I-130A', '5', '8.a', NULL,
       'Katy''s signature (preparer), signed and dated.', NULL, NULL, ARRAY['AOS-F-I130A']::text[],
       'case_type', 'firm_checklist', false, 121, 'spousal'
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-003');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-003'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-003') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-003'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-003') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-003'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-003') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-130A-LANG', 'English or interpreter box (Part 4, item 1), and the interpreter section (Part 5).', 'fatal', 'pdf',
       'I-130A', '3-4', NULL, NULL,
       'English or interpreter box as intended.', 'Q-67, decided by the server from what the model reads.', NULL, ARRAY['AOS-F-I130A']::text[],
       'case_type', 'firm_checklist', false, 122, 'spousal'
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-LANG');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-LANG'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-LANG') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-LANG'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-LANG') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-LANG'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-130A-LANG') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-485-001', 'Applicant''s name and date of birth.', 'fatal', 'pdf',
       'I-485', '1', NULL, NULL,
       'Applicant''s name and date of birth.', NULL, NULL, ARRAY['AOS-F-I485']::text[],
       'case_type', 'firm_checklist', false, 123, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-001');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-001'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-001') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-001'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-001') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-001'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-001') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-485-002', 'Applicant''s signature, signed and dated.', 'fatal', 'pdf',
       'I-485', '22', '4', NULL,
       'Applicant''s signature, signed and dated.', NULL, NULL, ARRAY['AOS-F-I485']::text[],
       'case_type', 'firm_checklist', false, 124, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-002');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-002'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-002') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-002'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-002') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-002'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-002') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-485-003', 'Katy''s signature (preparer), signed and dated.', 'fatal', 'pdf',
       'I-485', '23', '6', NULL,
       'Katy''s signature (preparer), signed and dated.', NULL, NULL, ARRAY['AOS-F-I485']::text[],
       'case_type', 'firm_checklist', false, 125, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-003');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-003'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-003') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-003'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-003') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-003'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-003') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-485-LANG', 'Interpreter section (Part 11): signed and dated when it is filled in.', 'fatal', 'pdf',
       'I-485', '22', NULL, NULL,
       'Interpreter section as intended.', 'Q-67. The 09/18/26 edition has no English or interpreter box in Part 10; the box test applies only to an edition that has them.', NULL, ARRAY['AOS-F-I485']::text[],
       'case_type', 'firm_checklist', false, 126, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-LANG');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-LANG'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-LANG') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-LANG'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-LANG') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-LANG'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-485-LANG') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-765-001', 'Initial permission to accept employment, and the applicant''s name.', 'fatal', 'pdf',
       'I-765', '1', '1.a', NULL,
       'Initial permission to accept employment, and the applicant''s name.', NULL, NULL, ARRAY['AOS-F-I765']::text[],
       'case_type', 'firm_checklist', false, 127, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-001');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-001'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-001') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-001'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-001') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-001'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-001') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-765-002', 'Applicant''s mailing and physical address.', 'fatal', 'pdf',
       'I-765', '2', '5-7', NULL,
       'Applicant''s mailing and physical address.', NULL, NULL, ARRAY['AOS-F-I765']::text[],
       'case_type', 'firm_checklist', false, 128, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-002');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-002'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-002') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-002'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-002') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-002'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-002') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-765-003', 'Eligibility category (c)(9), adjustment applicant.', 'fatal', 'pdf',
       'I-765', '3', '27', '(c)(9)',
       'Eligibility category (c)(9), adjustment applicant.', NULL, NULL, ARRAY['AOS-F-I765']::text[],
       'case_type', 'firm_checklist', false, 129, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-003');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-003'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-003') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-003'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-003') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-003'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-003') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-765-004', 'Applicant''s signature, signed and dated.', 'fatal', 'pdf',
       'I-765', '4', '7.a', NULL,
       'Applicant''s signature, signed and dated.', NULL, NULL, ARRAY['AOS-F-I765']::text[],
       'case_type', 'firm_checklist', false, 130, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-004');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-004'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-004') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-004'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-004') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-004'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-004') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-765-005', 'Katy''s signature (preparer), signed and dated.', 'fatal', 'pdf',
       'I-765', '6', '8.a', NULL,
       'Katy''s signature (preparer), signed and dated.', NULL, NULL, ARRAY['AOS-F-I765']::text[],
       'case_type', 'firm_checklist', false, 131, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-005');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-005'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-005') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-005'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-005') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-005'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-005') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-765-LANG', 'English or interpreter box (Part 3, item 1), and the interpreter section (Part 4), signed and dated when needed.', 'fatal', 'pdf',
       'I-765', '4-5', NULL, NULL,
       'English or interpreter box as intended.', 'Q-67, decided by the server from what the model reads.', NULL, ARRAY['AOS-F-I765']::text[],
       'case_type', 'firm_checklist', false, 132, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-LANG');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-LANG'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-LANG') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-LANG'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-LANG') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-LANG'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-765-LANG') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-864P-001', 'Petitioner''s I-864: the sponsor''s name and address, and the immigrant''s name and address.', 'fatal', 'pdf',
       'I-864', '1-3', NULL, NULL,
       'Petitioner''s I-864: the sponsor''s name and address, and the immigrant''s name and address.', NULL, NULL, ARRAY['AOS-F-I864']::text[],
       'case_type', 'firm_checklist', false, 133, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-001');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-001'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-001') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-001'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-001') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-001'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-001') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-864P-002', 'Petitioner''s I-864: current individual annual income, current annual household income and the most recent tax year''s income are filled in.', 'fatal', 'pdf',
       'I-864', '5-7', '7, 12, 16.a', NULL,
       'Petitioner''s I-864: current individual annual income, current annual household income and the most recent tax year''s income are filled in.', 'Q-69: filled in only; never matched to the tax return or W-2, never checked against the poverty guideline.', NULL, ARRAY['AOS-F-I864']::text[],
       'case_type', 'firm_checklist', false, 134, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-002');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-002'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-002') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-002'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-002') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-002'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-002') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-864P-003', 'Petitioner''s I-864: sponsor''s signature, signed and dated.', 'fatal', 'pdf',
       'I-864', '10', '6', NULL,
       'Petitioner''s I-864: sponsor''s signature, signed and dated.', NULL, NULL, ARRAY['AOS-F-I864']::text[],
       'case_type', 'firm_checklist', false, 135, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-003');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-003'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-003') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-003'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-003') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-003'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-003') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-864P-004', 'Petitioner''s I-864: Katy''s signature (preparer), signed and dated.', 'fatal', 'pdf',
       'I-864', '11', '6', NULL,
       'Petitioner''s I-864: Katy''s signature (preparer), signed and dated.', NULL, NULL, ARRAY['AOS-F-I864']::text[],
       'case_type', 'firm_checklist', false, 136, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-004');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-004'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-004') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-004'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-004') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-004'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864P-004') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-864J-001', 'Co-sponsor''s I-864: the co-sponsor''s name and address, and the immigrant''s name and address.', 'fatal', 'pdf',
       'I-864', '1-3', NULL, NULL,
       'Co-sponsor''s I-864: the co-sponsor''s name and address, and the immigrant''s name and address.', NULL, NULL, '{}'::text[],
       'case_type', 'firm_checklist', false, 137, 'joint_sponsor'
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-001');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-001'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-001') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-001'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-001') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-001'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-001') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-864J-002', 'Co-sponsor''s I-864: current individual annual income and the recent tax years'' income are filled in.', 'fatal', 'pdf',
       'I-864', '5-7', '7, 16.a-16.c', NULL,
       'Co-sponsor''s I-864: current individual annual income and the recent tax years'' income are filled in.', 'Q-69: filled in only.', NULL, '{}'::text[],
       'case_type', 'firm_checklist', false, 138, 'joint_sponsor'
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-002');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-002'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-002') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-002'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-002') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-002'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-002') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-864J-003', 'Co-sponsor''s I-864: co-sponsor''s signature, signed and dated.', 'fatal', 'pdf',
       'I-864', '10', '6', NULL,
       'Co-sponsor''s I-864: co-sponsor''s signature, signed and dated.', NULL, NULL, '{}'::text[],
       'case_type', 'firm_checklist', false, 139, 'joint_sponsor'
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-003');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-003'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-003') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-003'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-003') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-003'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-003') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-864J-004', 'Co-sponsor''s I-864: Katy''s signature (preparer), signed and dated.', 'fatal', 'pdf',
       'I-864', '11', '6', NULL,
       'Co-sponsor''s I-864: Katy''s signature (preparer), signed and dated.', NULL, NULL, '{}'::text[],
       'case_type', 'firm_checklist', false, 140, 'joint_sponsor'
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-004');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-004'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-004') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-004'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-004') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-004'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864J-004') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-864A-001', 'Household member''s name and address (page 1), employment and income (page 2), and the intending immigrant''s name (page 3).', 'fatal', 'pdf',
       'I-864A', '1-3', NULL, NULL,
       'Household member''s name and address (page 1), employment and income (page 2), and the intending immigrant''s name (page 3).', 'Q-69: income filled in only.', NULL, '{}'::text[],
       'case_type', 'firm_checklist', false, 141, 'household_member'
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-001');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-001'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-001') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-001'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-001') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-001'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-001') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-864A-002', 'Sponsor''s signature, signed and dated.', 'fatal', 'pdf',
       'I-864A', '4', '10', NULL,
       'Sponsor''s signature, signed and dated.', NULL, NULL, '{}'::text[],
       'case_type', 'firm_checklist', false, 142, 'household_member'
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-002');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-002'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-002') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-002'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-002') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-002'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-002') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-864A-003', 'Household member''s signature, signed and dated.', 'fatal', 'pdf',
       'I-864A', '6', '7', NULL,
       'Household member''s signature, signed and dated.', NULL, NULL, '{}'::text[],
       'case_type', 'firm_checklist', false, 143, 'household_member'
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-003');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-003'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-003') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-003'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-003') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-003'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-003') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-864A-004', 'Katy''s signature (preparer), signed and dated.', 'fatal', 'pdf',
       'I-864A', '7', '6', NULL,
       'Katy''s signature (preparer), signed and dated.', NULL, NULL, '{}'::text[],
       'case_type', 'firm_checklist', false, 144, 'household_member'
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-004');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-004'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-004') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-004'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-004') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-004'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-864A-004') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-131-001', 'Applicant''s signature, signed and dated.', 'fatal', 'pdf',
       'I-131', '11', '4', NULL,
       'Applicant''s signature, signed and dated.', NULL, NULL, '{}'::text[],
       'case_type', 'firm_checklist', false, 145, 'i131'
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-131-001');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-131-001'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-131-001') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-131-001'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-131-001') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-131-001'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-131-001') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-131-002', 'Katy''s signature (preparer), signed and dated.', 'fatal', 'pdf',
       'I-131', '13', '6', NULL,
       'Katy''s signature (preparer), signed and dated.', NULL, NULL, '{}'::text[],
       'case_type', 'firm_checklist', false, 146, 'i131'
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-131-002');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-131-002'), 'draft_review', 'later', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-131-002') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-131-002'), 'preflight', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-131-002') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-131-002'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-131-002') AND stage = 'physical_scan');
INSERT INTO public.proof_scan_rules (rule_set_id, rule_id, title, severity, check_kind, form, page, item, expected,
                                     pass_text, note, source_note, applies_to_item_ids, scope, origin, retired, sort_order, applies_when)
SELECT (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1),
       'AOS-ASM-001', 'Pages are in order inside each form.', 'fatal', 'pdf',
       NULL, NULL, NULL, NULL,
       'Pages in order inside each form.', 'Q-71: the order of the forms in the package is not checked; "All forms in order" stays a staff task.', NULL, '{}'::text[],
       'case_type', 'firm_checklist', false, 147, NULL
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-ASM-001');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-ASM-001'), 'draft_review', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-ASM-001') AND stage = 'draft_review');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-ASM-001'), 'preflight', 'not_this_stage', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-ASM-001') AND stage = 'preflight');
INSERT INTO public.proof_scan_rule_stage_settings (rule_pk, stage, state, stage_title, stage_pass_text, stage_expected, gentle_if_no)
SELECT (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-ASM-001'), 'physical_scan', 'checked', NULL, NULL, NULL, false
WHERE NOT EXISTS (SELECT 1 FROM public.proof_scan_rule_stage_settings WHERE rule_pk = (SELECT id FROM public.proof_scan_rules WHERE rule_set_id = (SELECT id FROM public.proof_scan_rule_sets WHERE case_type = 'aos' AND version = 1) AND rule_id = 'AOS-ASM-001') AND stage = 'physical_scan');

-- ── END GENERATED ──
