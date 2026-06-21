-- Migration 1109: Document Template Library
-- Introduces a curated, IurisIQ-maintained library of suggested document templates.
-- Firms start with an empty document_checklists and import from this library.
-- is_recommended = true → included in one-click "Add Recommended Templates" import.
-- practice_area_key NULL = universal (applicable to all enabled PAs).
-- case_type_keys    NULL = all case types within the practice area.

-- ── Library table ─────────────────────────────────────────────────────────────

CREATE TABLE public.doc_template_library (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_name               text        NOT NULL,
  practice_area_key      text,                    -- NULL = universal
  case_type_keys         text[],                  -- NULL = all types in the PA
  doc_category           text        NOT NULL DEFAULT 'other',
  description            text,
  is_required_by_default boolean     NOT NULL DEFAULT true,
  is_recommended         boolean     NOT NULL DEFAULT false,
  sort_order             int         NOT NULL DEFAULT 99
);

ALTER TABLE public.doc_template_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY "doc_template_library_read"
  ON public.doc_template_library FOR SELECT
  TO authenticated USING (true);

-- ── Track library origin on adopted templates ─────────────────────────────────

ALTER TABLE public.document_checklists
  ADD COLUMN IF NOT EXISTS library_id uuid
    REFERENCES public.doc_template_library(id) ON DELETE SET NULL;

-- ── Seed: Universal ───────────────────────────────────────────────────────────

INSERT INTO public.doc_template_library
  (doc_name, practice_area_key, case_type_keys, doc_category, is_required_by_default, is_recommended, sort_order)
VALUES
  ('Photo ID (Driver''s License or Passport)', NULL, NULL, 'id',   true,  true,  10),
  ('Social Security Card',                     NULL, NULL, 'id',   false, true,  20);

-- ── Seed: Immigration — all case types ───────────────────────────────────────

INSERT INTO public.doc_template_library
  (doc_name, practice_area_key, case_type_keys, doc_category, is_required_by_default, is_recommended, sort_order)
VALUES
  ('Passport (all pages)',                                     'immigration', NULL, 'id',       true,  true,  10),
  ('I-94 Travel History (uscis.gov/i94)',                      'immigration', NULL, 'id',       true,  true,  20),
  ('Birth Certificate (with certified translation if needed)', 'immigration', NULL, 'id',       true,  true,  30),
  ('Last 3 months pay stubs',                                  'immigration', NULL, 'financial', true, true,  40),
  ('Last 2 years W-2 / 1099',                                 'immigration', NULL, 'financial', true, true,  50),
  ('Last 2 years federal tax returns',                         'immigration', NULL, 'financial', true, true,  60),
  ('Last 3 months bank statements',                            'immigration', NULL, 'financial', true, false, 70),
  ('Financial Affidavit of Support (I-864)',                   'immigration', NULL, 'financial', false,false, 80);

-- ── Seed: Immigration — Family-Based Petition ─────────────────────────────────

INSERT INTO public.doc_template_library
  (doc_name, practice_area_key, case_type_keys, doc_category, is_required_by_default, is_recommended, sort_order)
VALUES
  ('Petitioner''s Proof of U.S. Citizenship or LPR Status',   'immigration', ARRAY['family_based_petition'], 'id',       true,  true,  10),
  ('Marriage Certificate (with certified translation)',         'immigration', ARRAY['family_based_petition'], 'id',       true,  true,  20),
  ('Proof of Termination of Prior Marriages (if applicable)',  'immigration', ARRAY['family_based_petition'], 'other',    false, false, 30),
  ('Joint Sponsor Documents (I-864A, if applicable)',          'immigration', ARRAY['family_based_petition'], 'financial', false, false, 40);

-- ── Seed: Immigration — Adjustment of Status ─────────────────────────────────

INSERT INTO public.doc_template_library
  (doc_name, practice_area_key, case_type_keys, doc_category, is_required_by_default, is_recommended, sort_order)
VALUES
  ('Medical Examination (Form I-693, sealed envelope)',        'immigration', ARRAY['adjustment_of_status'], 'other',  true,  true,  10),
  ('Evidence of Lawful Entry into the U.S.',                   'immigration', ARRAY['adjustment_of_status'], 'id',     true,  true,  20),
  ('Proof of Continuous Physical Presence',                    'immigration', ARRAY['adjustment_of_status'], 'other',  false, false, 30);

-- ── Seed: Immigration — DACA ─────────────────────────────────────────────────

INSERT INTO public.doc_template_library
  (doc_name, practice_area_key, case_type_keys, doc_category, is_required_by_default, is_recommended, sort_order)
VALUES
  ('Proof of Entry Before Age 16',                             'immigration', ARRAY['daca'], 'id',    true, true,  10),
  ('Proof of Continuous Residence since June 15, 2007',        'immigration', ARRAY['daca'], 'id',    true, true,  20),
  ('School Records, Diplomas, or Transcripts',                 'immigration', ARRAY['daca'], 'other', true, true,  30),
  ('Prior DACA Approval Notice (if renewal)',                  'immigration', ARRAY['daca'], 'other', false,false, 40);

-- ── Seed: Immigration — Asylum ────────────────────────────────────────────────

INSERT INTO public.doc_template_library
  (doc_name, practice_area_key, case_type_keys, doc_category, is_required_by_default, is_recommended, sort_order)
VALUES
  ('Personal Declaration of Fear / Asylum Statement',          'immigration', ARRAY['asylum'], 'other', true, true,  10),
  ('Country Condition Evidence (news, reports, DOJ records)',  'immigration', ARRAY['asylum'], 'other', true, true,  20),
  ('Evidence of Past Persecution (photos, police reports)',    'immigration', ARRAY['asylum'], 'other', false,false, 30);

-- ── Seed: Criminal — all case types ──────────────────────────────────────────

INSERT INTO public.doc_template_library
  (doc_name, practice_area_key, case_type_keys, doc_category, is_required_by_default, is_recommended, sort_order)
VALUES
  ('Arrest Report / Police Report',                            'criminal', NULL, 'other',    true,  true,  10),
  ('Booking Sheet',                                            'criminal', NULL, 'other',    true,  true,  20),
  ('Charging Document (Indictment or Information)',            'criminal', NULL, 'pleading', true,  true,  30),
  ('Bail / Bond Documentation',                               'criminal', NULL, 'other',    false, true,  40),
  ('Discovery Materials (evidence list, lab reports)',         'criminal', NULL, 'other',    false, false, 50),
  ('Prior Criminal History / Rap Sheet',                      'criminal', NULL, 'other',    false, false, 60),
  ('Witness Statements (if available)',                        'criminal', NULL, 'other',    false, false, 70),
  ('Surveillance / Dashcam Video (if applicable)',             'criminal', NULL, 'other',    false, false, 80);

-- ── Seed: Personal Injury — all case types ───────────────────────────────────

INSERT INTO public.doc_template_library
  (doc_name, practice_area_key, case_type_keys, doc_category, is_required_by_default, is_recommended, sort_order)
VALUES
  ('Police / Incident Report',                                 'personal_injury', NULL, 'other',     true,  true,  10),
  ('Medical Records (all treating providers)',                 'personal_injury', NULL, 'other',     true,  true,  20),
  ('Medical Bills / Itemized Statements',                      'personal_injury', NULL, 'financial', true,  true,  30),
  ('Health Insurance Card and Explanation of Benefits (EOB)', 'personal_injury', NULL, 'financial', true,  true,  40),
  ('Photos of Injuries and Accident Scene',                    'personal_injury', NULL, 'other',     false, true,  50),
  ('Proof of Lost Wages / Employer Letter',                    'personal_injury', NULL, 'financial', false, false, 60),
  ('Prior Medical Records (pre-existing conditions)',          'personal_injury', NULL, 'other',     false, false, 70),
  ('Witness Contact Information',                              'personal_injury', NULL, 'other',     false, false, 80);

-- ── Seed: Personal Injury — Auto / Truck / Motorcycle ────────────────────────

INSERT INTO public.doc_template_library
  (doc_name, practice_area_key, case_type_keys, doc_category, is_required_by_default, is_recommended, sort_order)
VALUES
  ('Client''s Auto Insurance Declarations Page',               'personal_injury', ARRAY['auto_accident','truck_accident','motorcycle_accident'], 'financial', true,  true,  10),
  ('Other Driver''s Insurance Information',                    'personal_injury', ARRAY['auto_accident','truck_accident','motorcycle_accident'], 'financial', true,  true,  20),
  ('Vehicle Photos / Damage Estimate',                         'personal_injury', ARRAY['auto_accident','truck_accident','motorcycle_accident'], 'other',    false, true,  30),
  ('Tow / Rental / Repair Receipts',                           'personal_injury', ARRAY['auto_accident','truck_accident','motorcycle_accident'], 'financial', false, false, 40);

-- ── Seed: Family Law — all case types ────────────────────────────────────────

INSERT INTO public.doc_template_library
  (doc_name, practice_area_key, case_type_keys, doc_category, is_required_by_default, is_recommended, sort_order)
VALUES
  ('Financial Affidavit',                                      'family_law', NULL, 'financial', true,  true,  10),
  ('Last 3 months pay stubs',                                  'family_law', NULL, 'financial', true,  true,  20),
  ('Last 2 years W-2 / 1099',                                 'family_law', NULL, 'financial', true,  true,  30),
  ('Last 2 years federal tax returns',                         'family_law', NULL, 'financial', true,  true,  40),
  ('Last 3 months bank statements',                            'family_law', NULL, 'financial', true,  false, 50),
  ('Real estate deed(s) and mortgage statement(s)',            'family_law', NULL, 'financial', false, false, 60),
  ('Retirement account statements',                            'family_law', NULL, 'financial', false, false, 70),
  ('Vehicle titles',                                           'family_law', NULL, 'financial', false, false, 80);

-- ── Seed: Family Law — Divorce ────────────────────────────────────────────────

INSERT INTO public.doc_template_library
  (doc_name, practice_area_key, case_type_keys, doc_category, is_required_by_default, is_recommended, sort_order)
VALUES
  ('Marriage Certificate',                                     'family_law', ARRAY['divorce'], 'id',              true,  true,  10),
  ('Petition for Divorce',                                     'family_law', ARRAY['divorce'], 'pleading',        true,  true,  20),
  ('Decree of Divorce (draft/final)',                          'family_law', ARRAY['divorce'], 'agreement',       true,  true,  30),
  ('QDRO (if applicable)',                                     'family_law', ARRAY['divorce'], 'court_order',     false, false, 40),
  ('Closing letter',                                           'family_law', ARRAY['divorce'], 'correspondence',  true,  false, 50);
