-- Migration 001: Core domain tables
-- clients · matters · opposing_parties · children · key_dates · financial_info · documents · tasks · task_reminder_rules
-- Apply with: db-migrate.ps1 -Target dev|prod
-- Never hand-edit the live database — migrations are the only way schema changes.

-- ──────────────────────────────────────────────────────────────────────────────
-- ENUMS
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TYPE public.case_type AS ENUM (
  'divorce',
  'legal_separation',
  'custody',
  'child_support',
  'child_support_modification',
  'custody_modification',
  'paternity',
  'prenuptial_agreement',
  'postnuptial_agreement',
  'protective_order',
  'adoption',
  'other'
);
COMMENT ON TYPE public.case_type IS 'Add values via a new migration, never alter this enum directly';

CREATE TYPE public.matter_status AS ENUM ('intake', 'active', 'on_hold', 'closed');

CREATE TYPE public.billing_type AS ENUM ('hourly', 'flat_fee', 'contingency', 'hybrid');

CREATE TYPE public.task_priority AS ENUM ('low', 'normal', 'high', 'urgent');

CREATE TYPE public.task_status AS ENUM ('pending', 'in_progress', 'completed', 'cancelled');

CREATE TYPE public.key_date_type AS ENUM (
  'marriage',
  'separation',
  'divorce_final',
  'filing',
  'hearing',
  'mediation',
  'deposition',
  'trial',
  'deadline',
  'custom'
);

-- ──────────────────────────────────────────────────────────────────────────────
-- CLIENTS  (§10 Group ①  +  ⑦ compliance fields)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.clients (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- Identity
  first_name  text        NOT NULL,
  last_name   text        NOT NULL,
  dob         date,

  -- SSN: PENDING Q5 — column reserved, managed server-side only if enabled.
  -- ssn_encrypted text,  -- store only base64(AES-256-GCM(ssn)) via server function, never raw

  -- Contact
  phone               text,
  email               text,
  address_line1       text,
  address_line2       text,
  city                text,
  state               text DEFAULT 'TX',
  zip                 text,
  preferred_contact   text CHECK (preferred_contact IN ('phone', 'email', 'portal', 'text')),

  -- Employment / emergency
  employer                  text,
  emergency_contact_name    text,
  emergency_contact_phone   text,

  -- Compliance (Group ⑦)
  conflict_check_notes  text,
  -- DV: PENDING Q5 — is_dv_confidential gates extra RLS filters (see migration 003).
  is_dv_confidential    boolean NOT NULL DEFAULT false,

  active  boolean NOT NULL DEFAULT true,
  notes   text
);

CREATE INDEX idx_clients_name ON public.clients (last_name, first_name);
CREATE INDEX idx_clients_dv   ON public.clients (is_dv_confidential) WHERE is_dv_confidential = true;

-- updated_at trigger (shared function defined at end of this file)
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER clients_updated_at
  BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────
-- MATTERS  (§10 Groups ②  ⑥)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.matters (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid        NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- Matter identity (Group ②)
  case_type       public.case_type NOT NULL,
  case_number     text,
  court_county    text,
  judge_name      text,
  date_filed      date,
  status          public.matter_status NOT NULL DEFAULT 'intake',

  -- Assignment
  assigned_attorney_id  uuid,  -- FK set after users table exists (migration 002)

  -- Financial (Group ⑥)
  retainer_balance  numeric(10,2),
  billing_type      public.billing_type DEFAULT 'hourly',

  -- Confidentiality (drives RLS — PINNED for full record-level enforcement)
  is_dv_confidential  boolean NOT NULL DEFAULT false,

  notes  text
);

CREATE INDEX idx_matters_client  ON public.matters (client_id);
CREATE INDEX idx_matters_status  ON public.matters (status);
CREATE INDEX idx_matters_atty    ON public.matters (assigned_attorney_id);

CREATE TRIGGER matters_updated_at
  BEFORE UPDATE ON public.matters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────
-- OPPOSING PARTIES  (§10 Group ③)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.opposing_parties (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   uuid  NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),

  first_name              text NOT NULL,
  last_name               text,
  dob                     date,
  employer                text,

  opposing_counsel_name   text,
  opposing_counsel_firm   text,
  opposing_counsel_email  text,
  opposing_counsel_phone  text,

  -- Address may be sealed (DV/protective-order matters)
  address_line1       text,
  address_line2       text,
  city                text,
  state               text,
  zip                 text,
  is_address_restricted  boolean NOT NULL DEFAULT false
);

CREATE INDEX idx_opposing_matter ON public.opposing_parties (matter_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- CHILDREN  (§10 Group ⑤)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.children (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   uuid  NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),

  first_name          text NOT NULL,
  last_name           text,
  dob                 date,
  custody_arrangement text
);

CREATE INDEX idx_children_matter ON public.children (matter_id);

-- ──────────────────────────────────────────────────────────────────────────────
-- KEY DATES  (§10 Group ④)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.key_dates (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   uuid  NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),

  date_type     public.key_date_type NOT NULL,
  date_value    date NOT NULL,
  description   text,
  is_milestone  boolean NOT NULL DEFAULT false  -- used by smart reminder engine to trigger task creation
);

CREATE INDEX idx_key_dates_matter ON public.key_dates (matter_id);
CREATE INDEX idx_key_dates_value  ON public.key_dates (date_value);

-- ──────────────────────────────────────────────────────────────────────────────
-- FINANCIAL INFO  (§10 Group ⑥  — supplemental)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.financial_info (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   uuid  NOT NULL UNIQUE REFERENCES public.matters(id) ON DELETE CASCADE,
  updated_at  timestamptz NOT NULL DEFAULT now(),

  client_monthly_income    numeric(10,2),
  opposing_monthly_income  numeric(10,2),
  financial_affidavit_status  text DEFAULT 'not_started'
    CHECK (financial_affidavit_status IN ('not_started', 'draft', 'filed')),
  notes  text
);

CREATE TRIGGER financial_info_updated_at
  BEFORE UPDATE ON public.financial_info
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────
-- DOCUMENTS  (Wave 0 metadata; files live in Cloudflare R2)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.documents (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   uuid  NOT NULL REFERENCES public.matters(id) ON DELETE RESTRICT,
  uploaded_by uuid, -- FK set after users table (migration 002)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  name          text NOT NULL,
  file_name     text NOT NULL,
  file_size     bigint,
  r2_key        text NOT NULL UNIQUE,  -- Cloudflare R2 object key — this is the canonical file ref
  content_type  text,

  doc_type  text CHECK (doc_type IN ('pleading', 'agreement', 'correspondence', 'financial', 'id', 'court_order', 'other')),
  status    text NOT NULL DEFAULT 'received'
    CHECK (status IN ('pending', 'received', 'reviewed', 'filed', 'signed', 'expired')),

  -- For missing-doc discovery (Add-on A — reads this column, doesn't own the table)
  is_required       boolean NOT NULL DEFAULT false,
  required_by_date  date,

  notes  text
);

CREATE INDEX idx_documents_matter ON public.documents (matter_id);
CREATE INDEX idx_documents_status ON public.documents (status);

CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────
-- TASKS  (Wave 0 — task list + smart reminder engine)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.tasks (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   uuid  REFERENCES public.matters(id) ON DELETE SET NULL,
  client_id   uuid  REFERENCES public.clients(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  title        text NOT NULL,
  description  text,

  assigned_to  uuid, -- FK set after users table (migration 002)
  created_by   uuid, -- FK set after users table (migration 002)

  priority      public.task_priority NOT NULL DEFAULT 'normal',
  status        public.task_status   NOT NULL DEFAULT 'pending',
  due_date      date,
  reminder_at   timestamptz,  -- smart reminder engine fires Supabase webhook at this time

  completed_at  timestamptz,

  -- Breadcrumb for auto-created tasks (from reminder rules)
  auto_created_from_rule_id  uuid  -- FK added after task_reminder_rules table
);

CREATE INDEX idx_tasks_matter     ON public.tasks (matter_id);
CREATE INDEX idx_tasks_assigned   ON public.tasks (assigned_to);
CREATE INDEX idx_tasks_status     ON public.tasks (status);
CREATE INDEX idx_tasks_due        ON public.tasks (due_date) WHERE status NOT IN ('completed', 'cancelled');
CREATE INDEX idx_tasks_reminder   ON public.tasks (reminder_at) WHERE reminder_at IS NOT NULL AND status = 'pending';

CREATE TRIGGER tasks_updated_at
  BEFORE UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- ──────────────────────────────────────────────────────────────────────────────
-- TASK REMINDER RULES  (smart reminder engine config)
-- ──────────────────────────────────────────────────────────────────────────────
-- When a key_date of trigger_date_type is set on a matter, a task is auto-created
-- at (date_value + offset_days). Negative offset = before the date.

CREATE TABLE public.task_reminder_rules (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),

  trigger_date_type    public.key_date_type NOT NULL,
  offset_days          integer NOT NULL,
  task_title_template  text NOT NULL,  -- supports {client_name}, {matter_case_type}, {date}
  task_description_template  text,
  default_priority     public.task_priority NOT NULL DEFAULT 'normal',
  applies_to_case_types  public.case_type[],  -- NULL = applies to all case types

  active  boolean NOT NULL DEFAULT true
);

-- Back-fill FK from tasks to rules
ALTER TABLE public.tasks
  ADD CONSTRAINT fk_tasks_reminder_rule
  FOREIGN KEY (auto_created_from_rule_id)
  REFERENCES public.task_reminder_rules(id)
  ON DELETE SET NULL;

-- ──────────────────────────────────────────────────────────────────────────────
-- DEFAULT REMINDER RULES  (family-law lifecycle — refine per client)
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO public.task_reminder_rules (trigger_date_type, offset_days, task_title_template, task_description_template, default_priority, applies_to_case_types) VALUES
  ('hearing',       -7,  'Prepare hearing materials for {client_name}',       'Upcoming hearing in 7 days. Confirm all documents are filed.', 'high',   NULL),
  ('hearing',       -1,  'Confirm hearing logistics for {client_name}',        'Hearing tomorrow. Confirm time, location, client notified.',    'urgent', NULL),
  ('deadline',      -3,  'Deadline approaching: {client_name}',                'Filing deadline in 3 days.',                                   'high',   NULL),
  ('divorce_final', 14,  'Draft closing letter for {client_name}',             'Matter closed. Draft and send closing letter per Texas Bar guidance.', 'normal', ARRAY['divorce'::public.case_type, 'legal_separation'::public.case_type]),
  ('filing',        7,   'Send filed-copy to client: {client_name}',           'Confirm client received copy of filed documents.',             'normal', NULL);
