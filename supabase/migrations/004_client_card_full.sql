-- Migration 004: Full client card schema — family-law fields
-- Source: divorce, modification, enforcement, and premarital matter types.
-- Apply AFTER migrations 001, 002, 003.
--
-- What this migration does:
--   1. Expands case_type enum (Texas-specific types)
--   2. Expands clients table (middle name, SSN, DL, phone breakdown, employer detail, etc.)
--   3. Expands opposing_parties table (same fields as client + SSN)
--   4. Expands children table (SSN, health insurance, sex, dispute flags)
--   5. Expands matters table (marriage/separation detail, circumstances, enforcement/modification fields)
--   6. Expands financial_info table (property sketch from divorce intake)
--   7. New table: previous_marriages
--   8. New table: children_other_relationships
--   9. New table: conflict_questionnaire (DV screening — 15 questions)
--  10. RLS policies for new tables

-- ============================================================================
-- 1. CASE TYPE ENUM ADDITIONS
-- NOTE: PostgreSQL does not allow removing enum values. 'legal_separation' is
-- kept in the DB but excluded from all UI dropdowns (not used in Texas).
-- ============================================================================

ALTER TYPE public.case_type ADD VALUE IF NOT EXISTS 'sapcr_original';
      -- Original Suit Affecting Parent-Child Relationship (unmarried parents)
ALTER TYPE public.case_type ADD VALUE IF NOT EXISTS 'sapcr_modification';
      -- Modification SAPCR (custody/support/possession changes)
ALTER TYPE public.case_type ADD VALUE IF NOT EXISTS 'enforcement';
      -- Enforcement of existing orders (support, possession, property division)

COMMENT ON TYPE public.case_type IS
  'Texas family-law case types. legal_separation is deprecated (does not exist in TX) — exclude from UI dropdowns.';

-- ============================================================================
-- 2. CLIENTS TABLE EXPANSION
-- ============================================================================

-- Identity
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS middle_name        text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS former_maiden_name text;

-- Contact — break phone into home/work/cell/fax
-- Existing `phone` column = primary / cell (preserved for backward compat)
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS home_phone  text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS work_phone  text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS cell_phone  text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS fax         text;

-- Address additions
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS county             text;  -- Texas county (important for filing)
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS length_of_residence text;

-- Sensitive identifiers (server-side encrypted, never raw)
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS ssn_encrypted          text;  -- AES-256-GCM, managed by server function only
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS driver_license_number  text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS driver_license_state   text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS place_of_birth         text;

-- Employment detail
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS gross_annual_income    numeric(10,2);
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS employer_address_line1 text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS employer_city          text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS employer_state         text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS employer_zip           text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS length_of_employment   text;

-- Background
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS education          text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS living_with_others text;  -- people other than spouse/children living with client

-- Name restoration (divorce only)
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS name_restoration_requested boolean NOT NULL DEFAULT false;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS name_restored_to           text;

-- Intake meta
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS referral_source text
  CHECK (referral_source IN ('advertisement','attorney','client','financial_advisor','internet','other'));
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS referral_name text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS intake_date   date;

COMMENT ON COLUMN public.clients.ssn_encrypted IS
  'AES-256-GCM encrypted SSN. NEVER store plain text. Only accessible via server-side function. Last 4 digits may be shown in UI.';
COMMENT ON COLUMN public.clients.phone IS
  'Legacy primary contact phone. New records should use cell_phone/home_phone/work_phone.';

-- ============================================================================
-- 3. OPPOSING PARTIES TABLE EXPANSION
-- ============================================================================

ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS middle_name         text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS former_maiden_name  text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS county              text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS length_of_residence text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS mailing_address_line1 text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS mailing_city        text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS mailing_state       text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS mailing_zip         text;

-- Contact
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS home_phone  text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS work_phone  text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS cell_phone  text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS fax         text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS email       text;

-- Sensitive identifiers
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS ssn_encrypted          text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS driver_license_number  text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS driver_license_state   text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS place_of_birth         text;

-- Employment detail
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS gross_annual_income    numeric(10,2);
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS employer_address_line1 text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS employer_city          text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS employer_state         text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS employer_zip           text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS length_of_employment   text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS education              text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS living_with_others     text;

-- Opposing counsel address (forms include full address)
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS opposing_counsel_address text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS opposing_counsel_city    text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS opposing_counsel_state   text;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS opposing_counsel_zip     text;

-- Financial separation
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS physically_separated       boolean;
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS financial_arrangement      text
  CHECK (financial_arrangement IN ('joint_account','separate','other'));
ALTER TABLE public.opposing_parties ADD COLUMN IF NOT EXISTS financial_arrangement_notes text;

COMMENT ON COLUMN public.opposing_parties.ssn_encrypted IS
  'AES-256-GCM encrypted SSN. Required for vital statistics filings. Same security policy as clients.ssn_encrypted.';

-- ============================================================================
-- 4. CHILDREN TABLE EXPANSION
-- ============================================================================

ALTER TABLE public.children ADD COLUMN IF NOT EXISTS sex                text CHECK (sex IN ('M','F','other'));
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS place_of_birth     text;
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS ssn_encrypted      text;
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS current_residence  text;
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS special_needs      text;  -- health care problems, medical conditions

-- Health insurance (collected on all forms with children)
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS health_ins_company       text;
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS health_ins_id            text;
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS health_ins_group         text;
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS health_ins_type          text CHECK (health_ins_type IN ('employer','individual','other'));
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS health_ins_type_other    text;
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS health_ins_premium       numeric(10,2);
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS health_ins_premium_payer text;  -- who pays the premium

-- Dispute flags
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS paternity_dispute boolean NOT NULL DEFAULT false;
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS custody_dispute   boolean NOT NULL DEFAULT false;

-- Third-party custody / visitation claimants (free text)
ALTER TABLE public.children ADD COLUMN IF NOT EXISTS third_party_custody_notes text;

-- ============================================================================
-- 5. MATTERS TABLE EXPANSION
-- ============================================================================

-- Marriage detail
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS place_of_marriage     text;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS has_prenup             boolean NOT NULL DEFAULT false;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS prior_divorce_filed    boolean;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS prior_protective_order boolean;

-- Separation
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS separation_status    text
  CHECK (separation_status IN ('not_separated','separated','counseling'));
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS separation_date       date;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS marriage_counselor    text;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS separation_agreement  text
  CHECK (separation_agreement IN ('none','written','oral'));
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS separation_agreement_notes text;

-- Marriage circumstances (checkboxes from intake form)
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS involves_adultery         boolean NOT NULL DEFAULT false;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS involves_physical_abuse   boolean NOT NULL DEFAULT false;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS involves_cruelty          boolean NOT NULL DEFAULT false;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS involves_insupportibility boolean NOT NULL DEFAULT false;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS involves_mental_health    boolean NOT NULL DEFAULT false;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS involves_felony           boolean NOT NULL DEFAULT false;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS involves_std              boolean NOT NULL DEFAULT false;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS marital_difficulties      text;

-- Active suit / opposing counsel
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS suit_filed          boolean NOT NULL DEFAULT false;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS been_served         boolean;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS prior_attorney_consulted text;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS prior_attorney_retained  text;

-- Child support tracking (modification + enforcement cases)
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS child_support_monthly      numeric(10,2);
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS child_support_current      boolean;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS child_support_via_office   boolean;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS child_support_withheld     boolean;  -- withheld from obligor's paycheck

-- Modification-specific
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS modification_possession_notes    text;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS modification_conservatorship_notes text;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS modification_support_notes       text;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS modification_medical_notes       text;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS children_county_changed          boolean;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS children_county_previous         text;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS primary_custody_rationale        text;

-- Enforcement-specific
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS enforcement_order_title  text;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS enforcement_order_date   date;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS enforcement_court_number text;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS enforcement_violations   text[];
  -- array of: 'child_support','possession','health_insurance','alimony','property_division','other'

-- Premarital-specific
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS expected_marriage_date  date;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS expected_marriage_place text;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS client_has_will         boolean;
ALTER TABLE public.matters ADD COLUMN IF NOT EXISTS client_will_date        date;

-- ============================================================================
-- 6. FINANCIAL_INFO TABLE EXPANSION
-- (property sketch from divorce intake form section H)
-- ============================================================================

ALTER TABLE public.financial_info ADD COLUMN IF NOT EXISTS real_estate_gross_value   numeric(12,2);
ALTER TABLE public.financial_info ADD COLUMN IF NOT EXISTS liquid_assets_value       numeric(12,2);
ALTER TABLE public.financial_info ADD COLUMN IF NOT EXISTS retirement_description    text;
ALTER TABLE public.financial_info ADD COLUMN IF NOT EXISTS retirement_estimated_value numeric(12,2);
ALTER TABLE public.financial_info ADD COLUMN IF NOT EXISTS frequent_flyer_miles      text;
ALTER TABLE public.financial_info ADD COLUMN IF NOT EXISTS vehicles_description      text;  -- free text: make/model/value/title for each vehicle
ALTER TABLE public.financial_info ADD COLUMN IF NOT EXISTS other_assets_description  text;
ALTER TABLE public.financial_info ADD COLUMN IF NOT EXISTS total_liabilities         numeric(12,2);
ALTER TABLE public.financial_info ADD COLUMN IF NOT EXISTS weapons_description       text;

-- ============================================================================
-- 7. PREVIOUS MARRIAGES
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.previous_marriages (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),

  party                text NOT NULL CHECK (party IN ('client','opposing')),
  former_spouse_name   text NOT NULL,
  termination_date     date,
  termination_method   text  -- 'death', 'divorce', 'annulment', etc.
);

CREATE INDEX idx_prev_marriages_matter ON public.previous_marriages (matter_id);

-- ============================================================================
-- 8. CHILDREN FROM OTHER RELATIONSHIPS
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.children_other_relationships (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),

  party        text NOT NULL CHECK (party IN ('client','opposing')),
  first_name   text NOT NULL,
  last_name    text,
  dob          date,
  ssn_encrypted text,
  current_residence text
);

CREATE INDEX idx_children_other_matter ON public.children_other_relationships (matter_id);

-- ============================================================================
-- 9. CONFLICT QUESTIONNAIRE  (DV screening — administered at initial interview)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.conflict_questionnaire (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id       uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  administered_at timestamptz NOT NULL DEFAULT now(),
  administered_by uuid REFERENCES public.users(id) ON DELETE SET NULL,

  -- Q1: How do you and your spouse argue? (sub-questions)
  q1a_name_calling   text CHECK (q1a_name_calling   IN ('never','sometimes','frequently')),
  q1b_threats        text CHECK (q1b_threats        IN ('never','sometimes','frequently')),
  q1c_throw_hit      text CHECK (q1c_throw_hit      IN ('never','sometimes','frequently')),
  q1d_physical       text CHECK (q1d_physical       IN ('never','sometimes','frequently')),
  q1e_silent         text CHECK (q1e_silent         IN ('never','sometimes','frequently')),
  q1_comments        text,

  q2_feel_safe       text CHECK (q2_feel_safe       IN ('never','sometimes','frequently','always')),
  q2_comments        text,

  q3_threatened      text CHECK (q3_threatened      IN ('never','sometimes','frequently','always')),
  q3_comments        text,

  q4_isolated        text CHECK (q4_isolated        IN ('never','sometimes','frequently','always')),
  q4_comments        text,

  q5_hurt_threat     text CHECK (q5_hurt_threat     IN ('never','sometimes','frequently')),
  q5_comments        text,

  q6_family_pet      text CHECK (q6_family_pet      IN ('never','sometimes','frequently')),
  q6_comments        text,

  q7_forced          text CHECK (q7_forced          IN ('never','sometimes','frequently')),
  q7_comments        text,

  q8_property        text CHECK (q8_property        IN ('never','sometimes','frequently')),
  q8_comments        text,

  q9_weapon_threat   boolean,
  q9_weapon_type     text,

  q10_taken_children text CHECK (q10_taken_children IN ('never','sometimes','frequently')),
  q10_comments       text,

  q11_suicide        text CHECK (q11_suicide        IN ('never','sometimes','frequently')),
  q11_comments       text,

  q12_controls_money text CHECK (q12_controls_money IN ('never','sometimes','frequently')),
  q12_comments       text,

  q13_alcohol        text CHECK (q13_alcohol        IN ('never','sometimes','frequently')),
  q13_comments       text,

  q14_drugs          text CHECK (q14_drugs          IN ('never','sometimes','frequently')),
  q14_comments       text,

  q15_police         text CHECK (q15_police         IN ('never','sometimes','frequently')),
  q15_comments       text,

  -- Computed: flag for DV review if any high-risk indicators present
  dv_flag_review     boolean GENERATED ALWAYS AS (
    q1d_physical   = 'frequently'                          OR
    q5_hurt_threat IN ('sometimes','frequently')           OR
    q9_weapon_threat = true                                OR
    q15_police     IN ('sometimes','frequently')
  ) STORED
);

CREATE INDEX idx_conflict_q_matter ON public.conflict_questionnaire (matter_id);
CREATE INDEX idx_conflict_q_dv     ON public.conflict_questionnaire (dv_flag_review)
  WHERE dv_flag_review = true;

-- ============================================================================
-- 10. RLS POLICIES FOR NEW TABLES
-- ============================================================================

ALTER TABLE public.previous_marriages             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.children_other_relationships   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.conflict_questionnaire         ENABLE ROW LEVEL SECURITY;

-- All three tables: staff read/write (mirrors the pattern from 003_rls_policies.sql)
-- Use the same can_read / can_write helper functions defined in migration 003.

CREATE POLICY "prev_marriages_select" ON public.previous_marriages
  FOR SELECT USING (public.can_read('core'));

CREATE POLICY "prev_marriages_write" ON public.previous_marriages
  FOR ALL USING (public.can_write('core'));

CREATE POLICY "children_other_select" ON public.children_other_relationships
  FOR SELECT USING (public.can_read('core'));

CREATE POLICY "children_other_write" ON public.children_other_relationships
  FOR ALL USING (public.can_write('core'));

-- Conflict questionnaire: read requires write-level (sensitive DV data)
CREATE POLICY "conflict_q_select" ON public.conflict_questionnaire
  FOR SELECT USING (public.can_write('core'));

CREATE POLICY "conflict_q_write" ON public.conflict_questionnaire
  FOR ALL USING (public.can_write('core'));
