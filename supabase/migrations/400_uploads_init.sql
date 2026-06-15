-- Migration 400: Uploads module — document_checklists table + soft-delete on documents
-- Module: uploads | Branch: module/uploads | Range: 400-499
-- Apply AFTER migrations 001, 002, 003, 004.

-- ============================================================================
-- 1. SOFT-DELETE SUPPORT ON documents
--    The uploads module owns the document lifecycle. Soft-delete is correct for
--    a law firm (Texas retention ≥5 years). Hard-delete is Owner-only via the
--    delete-document function + explicit confirmation.
-- ============================================================================

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_documents_deleted
  ON public.documents (deleted_at) WHERE deleted_at IS NOT NULL;

-- ============================================================================
-- 2. DOCUMENT CHECKLISTS
--    Per-case-type list of standard documents to request. When staff applies
--    the checklist to a matter, one documents row (status='pending') is created
--    per checklist item. NULL case_type = applies to every case type.
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.document_checklists (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_type   public.case_type,
  doc_name    text NOT NULL,
  doc_category text CHECK (doc_category IN ('pleading','agreement','correspondence','financial','id','court_order','other')),
  description text,
  is_required_by_default boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0
);

ALTER TABLE public.document_checklists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "checklists_read" ON public.document_checklists
  FOR SELECT USING (public.can_read('uploads') OR public.can_read('core'));

CREATE POLICY "checklists_manage" ON public.document_checklists
  FOR ALL USING (public.can_admin('core'));

-- ============================================================================
-- 3. SEED — family-law standard document checklist (factory defaults)
--    Owner role can edit in-app via Settings → Doc Templates.
-- ============================================================================

INSERT INTO public.document_checklists (case_type, doc_name, doc_category, description, is_required_by_default, sort_order) VALUES

  -- ── Universal (all case types) ──────────────────────────────────────────
  (NULL, 'Photo ID (Driver''s License or Passport)',  'id',        'Government-issued photo ID',                                        true,   10),
  (NULL, 'Social Security Card',                      'id',        'Or documentation confirming SSN',                                   false,  20),
  (NULL, 'Financial Affidavit',                       'financial', 'Texas Family Code Form — income, expenses, assets, debts',          true,   30),
  (NULL, 'Last 3 months pay stubs',                   'financial', 'All employment income sources',                                     true,   40),
  (NULL, 'Last 2 years W-2 / 1099',                   'financial', 'All sources of income',                                             true,   50),
  (NULL, 'Last 2 years federal tax returns',           'financial', 'All pages including all schedules',                                 true,   60),
  (NULL, 'Last 3 months bank statements',             'financial', 'All accounts (checking, savings, money market)',                    true,   70),

  -- ── Divorce ─────────────────────────────────────────────────────────────
  ('divorce', 'Marriage Certificate',                          'id',          'Original or certified copy',                             true,  100),
  ('divorce', 'Petition for Divorce',                          'pleading',    'Filed petition (certified if available)',                 true,  110),
  ('divorce', 'Decree of Divorce (draft/final)',               'agreement',   'Proposed or signed final decree',                        true,  120),
  ('divorce', 'Real estate deed(s) and mortgage statement(s)', 'financial',   'All real property — deed and current mortgage balance',  false, 130),
  ('divorce', 'Retirement account statements',                 'financial',   '401(k), IRA, pension — most recent statement',           false, 140),
  ('divorce', 'Vehicle titles',                                'financial',   'All vehicles marital or community property',             false, 150),
  ('divorce', 'QDRO (if applicable)',                          'court_order', 'Qualified Domestic Relations Order for retirement split', false, 160),
  ('divorce', 'Closing letter',                                'correspondence','Closing letter to client on matter conclusion',         true,  170),

  -- ── SAPCR Original ──────────────────────────────────────────────────────
  ('sapcr_original', 'Original Petition (SAPCR)',              'pleading',    'Filed original suit affecting parent-child relationship', true,  200),
  ('sapcr_original', 'Birth certificate(s) — child(ren)',      'id',          'All children subject to the suit',                       true,  210),
  ('sapcr_original', 'SAPCR Final Order',                      'court_order', 'Signed final order for conservatorship and support',     true,  220),

  -- ── SAPCR Modification ──────────────────────────────────────────────────
  ('sapcr_modification', 'Existing SAPCR Order',               'court_order', 'Certified copy of the order being modified',             true,  300),
  ('sapcr_modification', 'Petition to Modify',                 'pleading',    'Filed modification petition',                            true,  310),
  ('sapcr_modification', 'Birth certificate(s) — child(ren)',  'id',          'All children subject to modification',                   true,  320),

  -- ── Custody ─────────────────────────────────────────────────────────────
  ('custody', 'Birth certificate(s) — child(ren)',             'id',          'All children involved',                                  true,  400),
  ('custody', 'Existing custody order (if any)',               'court_order', 'Prior orders regarding conservatorship',                 false, 410),

  -- ── Child Support ────────────────────────────────────────────────────────
  ('child_support', 'Birth certificate(s) — child(ren)',       'id',          'All children subject to support order',                  true,  500),
  ('child_support', 'Proof of paternity (if applicable)',       'court_order', 'AOP or paternity order',                                 false, 510),

  -- ── Enforcement ─────────────────────────────────────────────────────────
  ('enforcement', 'Order being enforced',                      'court_order', 'Certified copy of the court order to enforce',           true,  600),
  ('enforcement', 'Motion for Enforcement',                    'pleading',    'Filed enforcement motion',                               true,  610),
  ('enforcement', 'Evidence of violation',                     'other',       'Bank records, communications, or other proof',           false, 620),

  -- ── Protective Order ────────────────────────────────────────────────────
  ('protective_order', 'Application for Protective Order',     'pleading',    'Filed application',                                      true,  700),
  ('protective_order', 'Police or incident report(s)',         'other',       'If available and relevant',                              false, 710),

  -- ── Prenuptial Agreement ─────────────────────────────────────────────────
  ('prenuptial_agreement', 'Prenuptial agreement draft',       'agreement',   'Initial draft for review',                               true,  800),
  ('prenuptial_agreement', 'Asset and liability schedule',     'financial',   'Full disclosure — both parties',                         true,  810);
