-- Migration 1203: Flat Fee Milestone Engine
--
-- Adds jurisdiction_rules (50-state archetype config), invoice_type + flat_fee_route
-- columns to invoices, and flat_fee_milestones table for tracking earned flat-fee
-- milestone trust transfers.
--
-- Three archetypes:
--   trust_first     — flat fees go to trust, disbursed as milestones are earned (default / ABA)
--   operating_first — flat fees go to operating immediately; depositing in trust = commingling (IL)
--   choice          — attorney chooses with proper written disclosure (CA, NY, CO, WA, AZ)
--
-- Applied: dev ☐  prod ☐

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. JURISDICTION RULES TABLE (50 states + DC)
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.jurisdiction_rules (
  state_code                text        PRIMARY KEY,
  state_name                text        NOT NULL,
  flat_fee_archetype        text        NOT NULL DEFAULT 'trust_first'
                            CHECK (flat_fee_archetype IN ('trust_first','operating_first','choice')),
  retention_years           int         NOT NULL DEFAULT 5,
  disclosure_threshold      numeric(10,2),
  requires_client_signature boolean     NOT NULL DEFAULT false,
  reconciliation_frequency  text        NOT NULL DEFAULT 'monthly'
                            CHECK (reconciliation_frequency IN ('monthly','quarterly')),
  notes                     text
);

COMMENT ON TABLE public.jurisdiction_rules IS
  'State-specific trust accounting rules. Drives flat-fee routing, retention periods, and compliance prompts. '
  'Update via migration only — never hand-edit.';

-- Seed all 50 states + DC
INSERT INTO public.jurisdiction_rules
  (state_code, state_name, flat_fee_archetype, retention_years, disclosure_threshold, requires_client_signature, reconciliation_frequency, notes)
VALUES
  -- ── Trust-first (ABA default — advance flat fees go to trust until earned) ──
  ('AL','Alabama',          'trust_first',5,NULL,false,'monthly',NULL),
  ('AK','Alaska',           'trust_first',5,NULL,false,'monthly',NULL),
  ('AR','Arkansas',         'trust_first',5,NULL,false,'monthly',NULL),
  ('CT','Connecticut',      'trust_first',7,NULL,false,'quarterly','Quarterly reconciliation required; 7-year retention'),
  ('DC','District of Columbia','trust_first',5,NULL,false,'monthly',NULL),
  ('DE','Delaware',         'trust_first',5,NULL,false,'monthly',NULL),
  ('FL','Florida',          'trust_first',6,NULL,false,'monthly','Rule 1.15 — advance flat fees treated as advance retainers; held in trust until earned'),
  ('GA','Georgia',          'trust_first',5,NULL,false,'monthly',NULL),
  ('HI','Hawaii',           'trust_first',5,NULL,false,'monthly',NULL),
  ('ID','Idaho',            'trust_first',5,NULL,false,'monthly',NULL),
  ('IN','Indiana',          'trust_first',5,NULL,false,'monthly',NULL),
  ('IA','Iowa',             'trust_first',5,NULL,false,'monthly',NULL),
  ('KS','Kansas',           'trust_first',5,NULL,false,'monthly',NULL),
  ('KY','Kentucky',         'trust_first',5,NULL,false,'monthly',NULL),
  ('LA','Louisiana',        'trust_first',5,NULL,false,'quarterly','Quarterly reconciliation minimum per Rule 1.15'),
  ('ME','Maine',            'trust_first',5,NULL,false,'monthly',NULL),
  ('MD','Maryland',         'trust_first',5,NULL,false,'monthly',NULL),
  ('MA','Massachusetts',    'trust_first',7,NULL,false,'monthly','Rule 1.15(e)(7) — 7-year retention'),
  ('MI','Michigan',         'trust_first',5,NULL,false,'monthly',NULL),
  ('MN','Minnesota',        'trust_first',5,NULL,false,'monthly',NULL),
  ('MS','Mississippi',      'trust_first',5,NULL,false,'monthly',NULL),
  ('MT','Montana',          'trust_first',5,NULL,false,'monthly',NULL),
  ('NE','Nebraska',         'trust_first',5,NULL,false,'monthly',NULL),
  ('NV','Nevada',           'trust_first',5,NULL,false,'monthly',NULL),
  ('NH','New Hampshire',    'trust_first',5,NULL,false,'monthly',NULL),
  ('NJ','New Jersey',       'trust_first',7,NULL,false,'monthly','7-year retention'),
  ('NM','New Mexico',       'trust_first',5,NULL,false,'monthly',NULL),
  ('NC','North Carolina',   'trust_first',6,NULL,false,'monthly','6-year retention'),
  ('ND','North Dakota',     'trust_first',5,NULL,false,'monthly',NULL),
  ('OH','Ohio',             'trust_first',7,NULL,false,'monthly','7-year retention per Rule 1.15(b)'),
  ('OK','Oklahoma',         'trust_first',5,NULL,false,'monthly',NULL),
  ('OR','Oregon',           'trust_first',5,NULL,false,'monthly',NULL),
  ('PA','Pennsylvania',     'trust_first',5,NULL,false,'monthly',NULL),
  ('RI','Rhode Island',     'trust_first',7,NULL,false,'monthly','7-year retention'),
  ('SC','South Carolina',   'trust_first',6,NULL,false,'monthly','6-year retention'),
  ('SD','South Dakota',     'trust_first',5,NULL,false,'monthly',NULL),
  ('TN','Tennessee',        'trust_first',5,NULL,false,'monthly',NULL),
  ('TX','Texas',            'trust_first',5,NULL,false,'monthly','TAJF notification required within 30 days of opening/closing account'),
  ('UT','Utah',             'trust_first',5,NULL,false,'monthly',NULL),
  ('VT','Vermont',          'trust_first',5,NULL,false,'monthly',NULL),
  ('VA','Virginia',         'trust_first',5,NULL,false,'monthly',NULL),
  ('WV','West Virginia',    'trust_first',5,NULL,false,'monthly',NULL),
  ('WI','Wisconsin',        'trust_first',6,NULL,false,'monthly','SCR 20:1.15(i) — 6-year retention'),
  ('WY','Wyoming',          'trust_first',5,NULL,false,'monthly',NULL),

  -- ── Operating-first (flat fee is property of attorney upon receipt; trust = commingling) ──
  ('IL','Illinois',         'operating_first',7,NULL,false,'quarterly','Rule 1.15(d) — advance fixed fees go to operating, not trust; quarterly reconciliation; 7-year retention'),

  -- ── Choice (attorney may choose with proper written disclosure) ──
  ('AZ','Arizona',          'choice',5,NULL,   false,'monthly', 'ER 1.15 — operating allowed with written disclosure'),
  ('CA','California',       'choice',5,1000.00, true,'monthly', 'Rule 1.15(b) — operating allowed with written disclosure; client signature required if amount > $1,000'),
  ('CO','Colorado',         'choice',7,NULL,   false,'quarterly','RPC 1.15(f) + Opinion 134 — operating allowed with written disclosure; quarterly reconciliation; 7-year retention'),
  ('MO','Missouri',         'choice',5,NULL,   false,'monthly', 'Choice varies by fee agreement terms'),
  ('NY','New York',         'choice',7,NULL,   false,'monthly', 'Ethics Op 983 — either trust or operating by written agreement; 7-year retention'),
  ('WA','Washington',       'choice',5,NULL,   false,'monthly', 'RPC 1.15B — operating allowed with written fee agreement')
ON CONFLICT (state_code) DO NOTHING;

-- RLS: read-only reference data for all authenticated users
ALTER TABLE public.jurisdiction_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "jurisdiction_rules_select"
  ON public.jurisdiction_rules FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. INVOICE ENHANCEMENTS
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS invoice_type text NOT NULL DEFAULT 'hourly'
    CHECK (invoice_type IN ('hourly','flat_fee','retainer','expense')),
  ADD COLUMN IF NOT EXISTS flat_fee_route text
    CHECK (flat_fee_route IN ('trust','operating')),
  ADD COLUMN IF NOT EXISTS flat_fee_disclosure_at timestamptz;

COMMENT ON COLUMN public.invoices.invoice_type IS
  'hourly: time-billed. flat_fee: fixed price. retainer: availability retainer. expense: cost reimbursement.';
COMMENT ON COLUMN public.invoices.flat_fee_route IS
  'For flat_fee invoices: trust = held in IOLTA until earned via milestones; '
  'operating = deposited directly to operating account (IL, or choice states with written disclosure).';
COMMENT ON COLUMN public.invoices.flat_fee_disclosure_at IS
  'Timestamp when attorney confirmed written flat-fee disclosure was obtained (choice states only).';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. FLAT FEE MILESTONES
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.flat_fee_milestones (
  id              uuid          PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at      timestamptz   NOT NULL DEFAULT now(),

  invoice_id      uuid          NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  matter_id       uuid          NOT NULL REFERENCES public.matters(id)  ON DELETE RESTRICT,

  description     text          NOT NULL,
  amount          numeric(10,2) NOT NULL CHECK (amount > 0),
  sort_order      int           NOT NULL DEFAULT 0,

  -- Set when attorney marks this milestone as earned
  earned_at       timestamptz,
  earned_by       uuid          REFERENCES public.users(id),

  -- Trust ledger entry created when milestone is marked earned (trust_first route only)
  trust_entry_id  uuid          REFERENCES public.trust_ledger_entries(id)
);

CREATE INDEX idx_milestones_invoice ON public.flat_fee_milestones (invoice_id);
CREATE INDEX idx_milestones_matter  ON public.flat_fee_milestones (matter_id);

COMMENT ON TABLE public.flat_fee_milestones IS
  'Earned-value milestones for flat-fee invoices routed through trust. '
  'Marking a milestone earned triggers a disbursement from trust for that milestone amount. '
  'Sum of milestone amounts must equal the invoice amount.';

ALTER TABLE public.flat_fee_milestones ENABLE ROW LEVEL SECURITY;

CREATE POLICY "milestones_select"
  ON public.flat_fee_milestones FOR SELECT
  USING (public.can_read('trust_accounting'));

CREATE POLICY "milestones_insert"
  ON public.flat_fee_milestones FOR INSERT
  WITH CHECK (public.can_write('trust_accounting'));

CREATE POLICY "milestones_update"
  ON public.flat_fee_milestones FOR UPDATE
  USING (public.can_write('trust_accounting'));

CREATE POLICY "milestones_no_delete"
  ON public.flat_fee_milestones FOR DELETE
  USING (false);
