-- ALL_MIGRATIONS_SANDBOX.sql
-- Auto-generated: concatenation of all migrations in correct order.
-- Run this against a fresh Supabase project to bootstrap the full schema.
-- DO NOT edit manually — regenerate via the PowerShell snippet in new-client-setup.md.

-- ════════════════════════════════════════
-- 001_core_tables.sql
-- ════════════════════════════════════════
-- Migration 001: Core domain tables
-- clients Â· matters Â· opposing_parties Â· children Â· key_dates Â· financial_info Â· documents Â· tasks Â· task_reminder_rules
-- Apply with: db-migrate.ps1 -Target dev|prod
-- Never hand-edit the live database â€” migrations are the only way schema changes.

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- ENUMS
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- CLIENTS  (Â§10 Group â‘   +  â‘¦ compliance fields)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE public.clients (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- Identity
  first_name  text        NOT NULL,
  last_name   text        NOT NULL,
  dob         date,

  -- SSN: PENDING Q5 â€” column reserved, managed server-side only if enabled.
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

  -- Compliance (Group â‘¦)
  conflict_check_notes  text,
  -- DV: PENDING Q5 â€” is_dv_confidential gates extra RLS filters (see migration 003).
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

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- MATTERS  (Â§10 Groups â‘¡  â‘¥)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE public.matters (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id   uuid        NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  -- Matter identity (Group â‘¡)
  case_type       public.case_type NOT NULL,
  case_number     text,
  court_county    text,
  judge_name      text,
  date_filed      date,
  status          public.matter_status NOT NULL DEFAULT 'intake',

  -- Assignment
  assigned_attorney_id  uuid,  -- FK set after users table exists (migration 002)

  -- Financial (Group â‘¥)
  retainer_balance  numeric(10,2),
  billing_type      public.billing_type DEFAULT 'hourly',

  -- Confidentiality (drives RLS â€” PINNED for full record-level enforcement)
  is_dv_confidential  boolean NOT NULL DEFAULT false,

  notes  text
);

CREATE INDEX idx_matters_client  ON public.matters (client_id);
CREATE INDEX idx_matters_status  ON public.matters (status);
CREATE INDEX idx_matters_atty    ON public.matters (assigned_attorney_id);

CREATE TRIGGER matters_updated_at
  BEFORE UPDATE ON public.matters
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- OPPOSING PARTIES  (Â§10 Group â‘¢)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- CHILDREN  (Â§10 Group â‘¤)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- KEY DATES  (Â§10 Group â‘£)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- FINANCIAL INFO  (Â§10 Group â‘¥  â€” supplemental)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- DOCUMENTS  (Wave 0 metadata; files live in Cloudflare R2)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE public.documents (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id   uuid  NOT NULL REFERENCES public.matters(id) ON DELETE RESTRICT,
  uploaded_by uuid, -- FK set after users table (migration 002)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  name          text NOT NULL,
  file_name     text NOT NULL,
  file_size     bigint,
  r2_key        text NOT NULL UNIQUE,  -- Cloudflare R2 object key â€” this is the canonical file ref
  content_type  text,

  doc_type  text CHECK (doc_type IN ('pleading', 'agreement', 'correspondence', 'financial', 'id', 'court_order', 'other')),
  status    text NOT NULL DEFAULT 'received'
    CHECK (status IN ('pending', 'received', 'reviewed', 'filed', 'signed', 'expired')),

  -- For missing-doc discovery (Add-on A â€” reads this column, doesn't own the table)
  is_required       boolean NOT NULL DEFAULT false,
  required_by_date  date,

  notes  text
);

CREATE INDEX idx_documents_matter ON public.documents (matter_id);
CREATE INDEX idx_documents_status ON public.documents (status);

CREATE TRIGGER documents_updated_at
  BEFORE UPDATE ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- TASKS  (Wave 0 â€” task list + smart reminder engine)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- TASK REMINDER RULES  (smart reminder engine config)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- DEFAULT REMINDER RULES  (family-law lifecycle â€” refine per client)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.task_reminder_rules (trigger_date_type, offset_days, task_title_template, task_description_template, default_priority, applies_to_case_types) VALUES
  ('hearing',       -7,  'Prepare hearing materials for {client_name}',       'Upcoming hearing in 7 days. Confirm all documents are filed.', 'high',   NULL),
  ('hearing',       -1,  'Confirm hearing logistics for {client_name}',        'Hearing tomorrow. Confirm time, location, client notified.',    'urgent', NULL),
  ('deadline',      -3,  'Deadline approaching: {client_name}',                'Filing deadline in 3 days.',                                   'high',   NULL),
  ('divorce_final', 14,  'Draft closing letter for {client_name}',             'Matter closed. Draft and send closing letter per Texas Bar guidance.', 'normal', ARRAY['divorce'::public.case_type, 'legal_separation'::public.case_type]),
  ('filing',        7,   'Send filed-copy to client: {client_name}',           'Confirm client received copy of filed documents.',             'normal', NULL);


-- ════════════════════════════════════════
-- 002_rbac.sql
-- ════════════════════════════════════════
-- Migration 002: RBAC â€” roles Â· users (profiles) Â· modules Â· role_module_access
-- Also: FK back-fills, auth trigger, default roles/modules seed data.
-- Apply AFTER migration 001.

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- ENUMS
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TYPE public.access_level AS ENUM ('none', 'read', 'write', 'admin');

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- ROLES
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE public.roles (
  id              uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text  NOT NULL UNIQUE,
  description     text,
  is_system_role  boolean NOT NULL DEFAULT false,  -- system roles cannot be deleted
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- USERS  (profile table â€” shadows auth.users)
-- One row per auth.users row; created by trigger on auth signup.
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE public.users (
  id          uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_id     uuid  NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  role_id     uuid  NOT NULL REFERENCES public.roles(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),

  first_name  text NOT NULL,
  last_name   text NOT NULL,
  email       text NOT NULL,
  phone       text,
  active      boolean NOT NULL DEFAULT true,

  -- Invite state
  invited_by  uuid  REFERENCES public.users(id),
  invited_at  timestamptz
);

CREATE INDEX idx_users_auth_id ON public.users (auth_id);
CREATE INDEX idx_users_role_id ON public.users (role_id);
CREATE INDEX idx_users_email   ON public.users (email);

CREATE TRIGGER users_updated_at
  BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Back-fill FKs in core tables now that users exists
ALTER TABLE public.matters
  ADD CONSTRAINT fk_matters_attorney
  FOREIGN KEY (assigned_attorney_id) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.documents
  ADD CONSTRAINT fk_documents_uploaded_by
  FOREIGN KEY (uploaded_by) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.tasks
  ADD CONSTRAINT fk_tasks_assigned_to
  FOREIGN KEY (assigned_to) REFERENCES public.users(id) ON DELETE SET NULL;

ALTER TABLE public.tasks
  ADD CONSTRAINT fk_tasks_created_by
  FOREIGN KEY (created_by) REFERENCES public.users(id) ON DELETE SET NULL;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- MODULES  (registry â€” the extension contract)
-- Modules self-register here. Adding a module = INSERT + append to registry.js.
-- Migration number ranges: core 001-099, billing 100-199, ai_brain 200-299,
--   messaging 300-399, uploads 400-499, esign 500-599, draft_forms 600-699,
--   dashboard 700-799, word_embed 800-899, (future 900-999).
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE public.modules (
  key               text  PRIMARY KEY,
  name              text  NOT NULL,
  description       text,
  icon              text,    -- icon name string (maps to CSS icon class or SVG id)
  route             text,    -- hash route within portal, e.g. 'clients'
  wave              integer  NOT NULL DEFAULT 1,
  enabled_by_default  boolean NOT NULL DEFAULT false,
  sort_order          integer NOT NULL DEFAULT 0
);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- ROLE_MODULE_ACCESS  (the permission matrix)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE public.role_module_access (
  role_id       uuid  NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  module_key    text  NOT NULL REFERENCES public.modules(key) ON DELETE CASCADE,
  access_level  public.access_level NOT NULL DEFAULT 'none',
  PRIMARY KEY (role_id, module_key)
);

CREATE INDEX idx_rma_role   ON public.role_module_access (role_id);
CREATE INDEX idx_rma_module ON public.role_module_access (module_key);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- AUTH TRIGGER  â€” creates profile on Supabase auth signup
-- Default role: Paralegal (lowest privilege). Owner promotes via permissions UI.
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  default_role_id uuid;
BEGIN
  -- Fetch paralegal role as default (safest default)
  SELECT id INTO default_role_id FROM public.roles WHERE name = 'Paralegal' LIMIT 1;
  IF default_role_id IS NULL THEN
    -- Fallback: first non-system role
    SELECT id INTO default_role_id FROM public.roles WHERE is_system_role = false ORDER BY created_at LIMIT 1;
  END IF;

  INSERT INTO public.users (auth_id, role_id, first_name, last_name, email)
  VALUES (
    NEW.id,
    default_role_id,
    COALESCE(NEW.raw_user_meta_data->>'first_name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'last_name', ''),
    NEW.email
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- SEED: DEFAULT ROLES
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.roles (name, description, is_system_role) VALUES
  ('Owner',      'Full access to all modules and settings. Cannot be deleted.', true),
  ('Attorney',   'Client and matter management, tasks, uploads.',               false),
  ('Paralegal',  'Client intake, document tracking, tasks.',                    false),
  ('Staff Admin','User management and permissions.',                             false);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- SEED: MODULE REGISTRY
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default) VALUES
  ('core',         'Clients & Matters', 'Client cards, matter management, and client card.',  'users',         'clients',     0,  10, true),
  ('tasks',        'Tasks',             'Task list and smart reminder engine.',                'check-square',  'tasks',       0,  20, true),
  ('uploads',      'Document Uploads',  'Client document uploads and missing-doc tracking.',  'upload',        'uploads',     1,  30, false),
  ('messaging',    'Messaging',         'Two-way portal messaging â€” replaces email inbox.',   'message-square','messaging',   1,  40, false),
  ('billing',      'Billing & Time',    'Time tracking and invoicing.',                       'dollar-sign',   'billing',     1,  50, false),
  ('ai_brain',     'AI Assistant',      'RAG query box trained on your firm''s knowledge.',  'cpu',           'ai-brain',    1,  60, false),
  ('draft_forms',  'Document Drafting', 'Generate forms from your Dropbox templates.',        'file-text',     'draft-forms', 1,  70, false),
  ('esign',        'E-Signatures',      'In-portal e-sign with SHA-256 audit trail (UETA).',  'pen-tool',      'esign',       1,  80, false),
  ('dashboard',    'Analytics',         'Dashboard aggregating data across all modules.',     'bar-chart-2',   'dashboard',   2,  90, false),
  ('word_embed',   'Word Integration',  'Open and save Word documents without leaving portal.','file',         'word-embed',  2, 100, false);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- SEED: ROLE_MODULE_ACCESS  (default permission matrix)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

DO $$
DECLARE
  r_owner       uuid; r_attorney uuid; r_paralegal uuid; r_staffadmin uuid;
BEGIN
  SELECT id INTO r_owner       FROM public.roles WHERE name = 'Owner';
  SELECT id INTO r_attorney    FROM public.roles WHERE name = 'Attorney';
  SELECT id INTO r_paralegal   FROM public.roles WHERE name = 'Paralegal';
  SELECT id INTO r_staffadmin  FROM public.roles WHERE name = 'Staff Admin';

  -- Owner: admin on everything
  INSERT INTO public.role_module_access (role_id, module_key, access_level)
  SELECT r_owner, key, 'admin' FROM public.modules;

  -- Attorney: write on core + tasks + uploads; read on billing/dashboard
  INSERT INTO public.role_module_access (role_id, module_key, access_level) VALUES
    (r_attorney, 'core',        'write'),
    (r_attorney, 'tasks',       'write'),
    (r_attorney, 'uploads',     'write'),
    (r_attorney, 'messaging',   'write'),
    (r_attorney, 'billing',     'read'),
    (r_attorney, 'ai_brain',    'read'),
    (r_attorney, 'draft_forms', 'write'),
    (r_attorney, 'esign',       'write'),
    (r_attorney, 'dashboard',   'read'),
    (r_attorney, 'word_embed',  'write');

  -- Paralegal: write on core + tasks + uploads; no billing/ai/settings
  INSERT INTO public.role_module_access (role_id, module_key, access_level) VALUES
    (r_paralegal, 'core',        'write'),
    (r_paralegal, 'tasks',       'write'),
    (r_paralegal, 'uploads',     'write'),
    (r_paralegal, 'messaging',   'read'),
    (r_paralegal, 'draft_forms', 'read'),
    (r_paralegal, 'esign',       'read');

  -- Staff Admin: admin on user/permissions settings; read on core
  INSERT INTO public.role_module_access (role_id, module_key, access_level) VALUES
    (r_staffadmin, 'core',      'read'),
    (r_staffadmin, 'tasks',     'read'),
    (r_staffadmin, 'billing',   'admin'),
    (r_staffadmin, 'dashboard', 'read');
END;
$$;


-- ════════════════════════════════════════
-- 003_rls_policies.sql
-- ════════════════════════════════════════
-- Migration 003: Row Level Security policies
-- Apply AFTER migrations 001 + 002.
-- Principle: DB-level enforcement, not UI-only. Hiding menu items is UX, not security.
-- v1: module on/off access. Record-level (DV, assigned-matter scoping) PINNED â€” see Â§16 architecture.md.

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- HELPER FUNCTIONS
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- Returns the public.users.id for the currently authenticated user.
-- NULL if not found (user not yet synced or inactive).
CREATE OR REPLACE FUNCTION public.my_user_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.users WHERE auth_id = auth.uid() AND active = true LIMIT 1;
$$;

-- Returns the role_id for the current user.
CREATE OR REPLACE FUNCTION public.my_role_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT role_id FROM public.users WHERE auth_id = auth.uid() AND active = true LIMIT 1;
$$;

-- Checks whether the current user's role has at least min_level access to a module.
-- 'none' < 'read' < 'write' < 'admin'
CREATE OR REPLACE FUNCTION public.check_module_access(p_module_key text, p_min_level public.access_level)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_role_id   uuid;
  v_level     public.access_level;
BEGIN
  v_role_id := public.my_role_id();
  IF v_role_id IS NULL THEN RETURN false; END IF;

  SELECT access_level INTO v_level
  FROM public.role_module_access
  WHERE role_id = v_role_id AND module_key = p_module_key;

  IF v_level IS NULL THEN RETURN false; END IF;

  -- Enum comparison: cast to text ordinal via CASE
  RETURN CASE p_min_level
    WHEN 'none'  THEN true
    WHEN 'read'  THEN v_level IN ('read',  'write', 'admin')
    WHEN 'write' THEN v_level IN ('write', 'admin')
    WHEN 'admin' THEN v_level = 'admin'
    ELSE false
  END;
END;
$$;

-- Convenience wrappers used frequently in policies
CREATE OR REPLACE FUNCTION public.can_read(p_module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.check_module_access(p_module, 'read');
$$;

CREATE OR REPLACE FUNCTION public.can_write(p_module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.check_module_access(p_module, 'write');
$$;

CREATE OR REPLACE FUNCTION public.can_admin(p_module text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.check_module_access(p_module, 'admin');
$$;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- ENABLE RLS ON ALL TABLES
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE public.roles               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.users               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.modules             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_module_access  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.matters             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.opposing_parties    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.children            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.key_dates           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_info      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.documents           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_reminder_rules ENABLE ROW LEVEL SECURITY;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- ROLES TABLE
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE POLICY "roles_read"   ON public.roles FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "roles_manage" ON public.roles FOR ALL    USING (public.can_admin('core'));

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- USERS TABLE
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- Any authenticated active user can see the user list (needed for assignment dropdowns)
CREATE POLICY "users_read"    ON public.users FOR SELECT USING (public.my_user_id() IS NOT NULL);
-- Users can update their own profile (name, phone); admins can update anyone
CREATE POLICY "users_update"  ON public.users FOR UPDATE USING (
  auth_id = auth.uid() OR public.can_admin('core')
);
-- Only admins can create/delete users (invites go through Supabase Auth; this covers edge cases)
CREATE POLICY "users_manage"  ON public.users FOR ALL    USING (public.can_admin('core'));

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- MODULES TABLE  (config read-only for non-admins)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE POLICY "modules_read"   ON public.modules FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "modules_manage" ON public.modules FOR ALL    USING (public.can_admin('core'));

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- ROLE_MODULE_ACCESS
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE POLICY "rma_read"   ON public.role_module_access FOR SELECT USING (public.my_user_id() IS NOT NULL);
CREATE POLICY "rma_manage" ON public.role_module_access FOR ALL    USING (public.can_admin('core'));

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- CLIENTS
-- DV-confidential filter: PINNED for full implementation â€” v1 only Owner/admin can see DV records.
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE POLICY "clients_select" ON public.clients FOR SELECT USING (
  public.can_read('core')
  AND (NOT is_dv_confidential OR public.can_admin('core'))  -- DV gate (PINNED â€” tighten in v1 build)
);
CREATE POLICY "clients_insert" ON public.clients FOR INSERT WITH CHECK (public.can_write('core'));
CREATE POLICY "clients_update" ON public.clients FOR UPDATE USING (
  public.can_write('core')
  AND (NOT is_dv_confidential OR public.can_admin('core'))
);
CREATE POLICY "clients_delete" ON public.clients FOR DELETE USING (public.can_admin('core'));

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- MATTERS
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE POLICY "matters_select" ON public.matters FOR SELECT USING (
  public.can_read('core')
  AND (NOT is_dv_confidential OR public.can_admin('core'))
);
CREATE POLICY "matters_insert" ON public.matters FOR INSERT WITH CHECK (public.can_write('core'));
CREATE POLICY "matters_update" ON public.matters FOR UPDATE USING (
  public.can_write('core')
  AND (NOT is_dv_confidential OR public.can_admin('core'))
);
CREATE POLICY "matters_delete" ON public.matters FOR DELETE USING (public.can_admin('core'));

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- CHILD TABLES  (opposing_parties, children, key_dates, financial_info)
-- Access follows the parent matter's rules. Simplified here â€” full RLS inherits matter access.
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE POLICY "opposing_read"   ON public.opposing_parties FOR SELECT USING (public.can_read('core'));
CREATE POLICY "opposing_write"  ON public.opposing_parties FOR ALL    USING (public.can_write('core'));

CREATE POLICY "children_read"   ON public.children FOR SELECT USING (public.can_read('core'));
CREATE POLICY "children_write"  ON public.children FOR ALL    USING (public.can_write('core'));

CREATE POLICY "keydates_read"   ON public.key_dates FOR SELECT USING (public.can_read('core'));
CREATE POLICY "keydates_write"  ON public.key_dates FOR ALL    USING (public.can_write('core'));

CREATE POLICY "financial_read"  ON public.financial_info FOR SELECT USING (public.can_read('core'));
CREATE POLICY "financial_write" ON public.financial_info FOR ALL    USING (public.can_write('core'));

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- DOCUMENTS  (core module can see; uploads module manages them)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE POLICY "docs_select" ON public.documents FOR SELECT USING (public.can_read('core'));
CREATE POLICY "docs_insert" ON public.documents FOR INSERT WITH CHECK (
  public.can_write('uploads') OR public.can_write('core')
);
CREATE POLICY "docs_update" ON public.documents FOR UPDATE USING (
  public.can_write('uploads') OR public.can_write('core')
);
CREATE POLICY "docs_delete" ON public.documents FOR DELETE USING (public.can_admin('core'));

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- TASKS
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE POLICY "tasks_select" ON public.tasks FOR SELECT USING (public.can_read('tasks'));
CREATE POLICY "tasks_insert" ON public.tasks FOR INSERT WITH CHECK (public.can_write('tasks'));
CREATE POLICY "tasks_update" ON public.tasks FOR UPDATE USING (
  public.can_write('tasks')
  OR assigned_to = public.my_user_id()  -- assignees can update their own tasks
);
CREATE POLICY "tasks_delete" ON public.tasks FOR DELETE USING (public.can_admin('tasks'));

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- TASK REMINDER RULES  (config â€” admin only to edit)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE POLICY "reminder_rules_read"   ON public.task_reminder_rules FOR SELECT USING (public.can_read('tasks'));
CREATE POLICY "reminder_rules_manage" ON public.task_reminder_rules FOR ALL    USING (public.can_admin('core'));


-- ════════════════════════════════════════
-- 004_client_card_full.sql
-- ════════════════════════════════════════
-- Migration 004: Full client card schema â€” family-law fields
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
--   9. New table: conflict_questionnaire (DV screening â€” 15 questions)
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
  'Texas family-law case types. legal_separation is deprecated (does not exist in TX) â€” exclude from UI dropdowns.';

-- ============================================================================
-- 2. CLIENTS TABLE EXPANSION
-- ============================================================================

-- Identity
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS middle_name        text;
ALTER TABLE public.clients ADD COLUMN IF NOT EXISTS former_maiden_name text;

-- Contact â€” break phone into home/work/cell/fax
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
-- 9. CONFLICT QUESTIONNAIRE  (DV screening â€” administered at initial interview)
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


-- ════════════════════════════════════════
-- 005_client_portal.sql
-- ════════════════════════════════════════
-- Migration 005: Client portal foundation
-- Adds: auth_id on clients, Client role, Partner Attorney role,
--       client_portal module, RLS SELECT policies for client self-service.
-- Apply AFTER migrations 001â€“004.

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 1. LINK CLIENTS TO AUTH USERS
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS auth_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_clients_auth_id ON public.clients (auth_id);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 2. NEW ROLES
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.roles (name, description, is_system_role) VALUES
  ('Client',
   'Portal access for firm clients â€” view own matter, upload documents. Cannot see other clients.',
   true),
  ('Partner Attorney',
   'Full attorney access. Cannot manage users or firm settings.',
   false)
ON CONFLICT (name) DO NOTHING;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 3. CLIENT PORTAL MODULE
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default)
VALUES ('client_portal', 'My Matter', 'Client-facing view of their own matter and documents.',
        'user', 'client-portal', 0, 5, true)
ON CONFLICT (key) DO NOTHING;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 4. ROLE â†’ MODULE ACCESS
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

DO $$
DECLARE
  r_client  uuid;
  r_partner uuid;
BEGIN
  SELECT id INTO r_client  FROM public.roles WHERE name = 'Client';
  SELECT id INTO r_partner FROM public.roles WHERE name = 'Partner Attorney';

  -- Client: only the client_portal module (uploads happen through functions, not module access)
  INSERT INTO public.role_module_access (role_id, module_key, access_level)
  VALUES (r_client, 'client_portal', 'write')
  ON CONFLICT (role_id, module_key) DO NOTHING;

  -- Partner Attorney: same access as Attorney
  INSERT INTO public.role_module_access (role_id, module_key, access_level) VALUES
    (r_partner, 'core',         'write'),
    (r_partner, 'tasks',        'write'),
    (r_partner, 'uploads',      'write'),
    (r_partner, 'messaging',    'write'),
    (r_partner, 'billing',      'read'),
    (r_partner, 'ai_brain',     'read'),
    (r_partner, 'draft_forms',  'write'),
    (r_partner, 'esign',        'write'),
    (r_partner, 'dashboard',    'read'),
    (r_partner, 'word_embed',   'write')
  ON CONFLICT (role_id, module_key) DO NOTHING;
END $$;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 5. RLS HELPER: identify the current user's client record
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE OR REPLACE FUNCTION public.my_client_id()
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT id FROM public.clients WHERE auth_id = auth.uid() AND active = true LIMIT 1;
$$;

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 6. ADDITIVE RLS SELECT POLICIES FOR CLIENTS
-- Postgres ORs multiple permissive policies â€” these add to existing staff policies,
-- not replace them. Staff see all rows via existing policies; clients only see their own.
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- Clients can read their own client record
CREATE POLICY "clients_select_own"
  ON public.clients FOR SELECT
  USING (auth_id = auth.uid());

-- Clients can read their own matters (DV records excluded)
CREATE POLICY "matters_select_client"
  ON public.matters FOR SELECT
  USING (
    client_id = public.my_client_id()
    AND NOT is_dv_confidential
  );

-- Clients can read key dates for their matters
CREATE POLICY "keydates_select_client"
  ON public.key_dates FOR SELECT
  USING (
    matter_id IN (
      SELECT id FROM public.matters
      WHERE client_id = public.my_client_id() AND NOT is_dv_confidential
    )
  );

-- Add deleted_at here so the policy below can reference it.
-- Migration 400 adds it idempotently; doing it here ensures ordering safety.
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

-- Clients can read documents for their matters (non-deleted only)
CREATE POLICY "docs_select_client"
  ON public.documents FOR SELECT
  USING (
    deleted_at IS NULL
    AND matter_id IN (
      SELECT id FROM public.matters
      WHERE client_id = public.my_client_id() AND NOT is_dv_confidential
    )
  );

-- Clients can read the modules table (needed for menu rendering)
-- Note: "modules_read" already covers auth.uid() IS NOT NULL, so this is redundant
-- but explicit for clarity â€” no change needed.

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 7. ENABLE RLS ON client_portal tables (modules already has RLS from migration 003)
-- Nothing new to enable â€” client_portal is a UI route, not a new table.
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€


-- ════════════════════════════════════════
-- 006_client_self_service.sql
-- ════════════════════════════════════════
-- Migration 006: Client portal self-service intake
-- Adds profile_completed_at so staff can see whether a client has filled in
-- their own contact/address details via the "My Profile" tab.
-- Apply AFTER migration 005.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS profile_completed_at timestamptz DEFAULT NULL;

COMMENT ON COLUMN public.clients.profile_completed_at IS
  'Set by update-client-profile function when client saves their profile via the portal. NULL = not yet submitted.';


-- ════════════════════════════════════════
-- 007_practice_areas.sql
-- ════════════════════════════════════════
-- Migration 007: Practice Areas & Case Types
-- Replaces the hardcoded case_type enum with a table-driven system.
-- Supports multiple practice areas per firm (family law, immigration, etc.)
-- Enabled practice areas are controlled via enabled_practice_areas (mirrors enabled_modules pattern).

-- â”€â”€ Reference tables â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE IF NOT EXISTS public.practice_areas (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text UNIQUE NOT NULL,
  name        text NOT NULL,
  description text,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.case_types (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  practice_area_id uuid NOT NULL REFERENCES public.practice_areas(id) ON DELETE CASCADE,
  key              text NOT NULL,
  name             text NOT NULL,
  sort_order       integer NOT NULL DEFAULT 0,
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (practice_area_id, key)
);

-- â”€â”€ Enabled practice areas (per-firm gate, like enabled_modules) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE IF NOT EXISTS public.enabled_practice_areas (
  practice_area_key text PRIMARY KEY,
  enabled_at        timestamptz NOT NULL DEFAULT now()
);

-- â”€â”€ Convert case_type columns from ENUM to text â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- The practice area refactor supersedes the case_type ENUM.
-- We keep matters.case_type as a text column for backward compat (doc template filtering still uses it).
-- task_reminder_rules.applies_to_case_types becomes text[] for the same reason.

ALTER TABLE public.matters
  ALTER COLUMN case_type TYPE text USING case_type::text,
  ALTER COLUMN case_type DROP NOT NULL;

ALTER TABLE public.task_reminder_rules
  ALTER COLUMN applies_to_case_types TYPE text[] USING applies_to_case_types::text[];

-- â”€â”€ Extend matters with FK columns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE public.matters
  ADD COLUMN IF NOT EXISTS practice_area_id uuid REFERENCES public.practice_areas(id),
  ADD COLUMN IF NOT EXISTS case_type_id     uuid REFERENCES public.case_types(id);

-- â”€â”€ Practice-area extension tables (stubs) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE IF NOT EXISTS public.client_family_law (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id  uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.client_immigration (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id             uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  a_number              text,
  visa_category         text,
  priority_date         date,
  receipt_number        text,
  petitioner_name       text,
  beneficiary_name      text,
  nationality           text,
  country_of_birth      text,
  last_entry_date       date,
  authorized_stay_until date,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- â”€â”€ Seed: Family Law â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.practice_areas (key, name, description, sort_order) VALUES
  ('family_law',  'Family Law',   'Divorce, custody, child support, adoption, and related matters', 10),
  ('immigration', 'Immigration',  'Visas, green cards, naturalization, removal defense, and related matters', 20)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.case_types (practice_area_id, key, name, sort_order)
SELECT pa.id, ct.key, ct.name, ct.sort_order
FROM public.practice_areas pa
CROSS JOIN (VALUES
  ('divorce',                   'Divorce',                          10),
  ('sapcr_original',            'SAPCR â€“ Original',                 20),
  ('sapcr_modification',        'SAPCR â€“ Modification',             30),
  ('enforcement',               'Enforcement',                      40),
  ('custody',                   'Custody',                          50),
  ('custody_modification',      'Custody Modification',             60),
  ('child_support',             'Child Support',                    70),
  ('child_support_modification','Child Support Modification',       80),
  ('paternity',                 'Paternity',                        90),
  ('prenuptial_agreement',      'Prenuptial Agreement',            100),
  ('postnuptial_agreement',     'Postnuptial Agreement',           110),
  ('protective_order',          'Protective Order',                120),
  ('adoption',                  'Adoption',                        130),
  ('other',                     'Other',                           999)
) AS ct(key, name, sort_order)
WHERE pa.key = 'family_law'
ON CONFLICT (practice_area_id, key) DO NOTHING;

-- â”€â”€ Seed: Immigration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.case_types (practice_area_id, key, name, sort_order)
SELECT pa.id, ct.key, ct.name, ct.sort_order
FROM public.practice_areas pa
CROSS JOIN (VALUES
  ('family_based_petition',   'Family-Based Petition',         10),
  ('adjustment_of_status',    'Adjustment of Status',          20),
  ('consular_processing',     'Consular Processing',           30),
  ('naturalization',          'Naturalization / Citizenship',  40),
  ('daca',                    'DACA / Deferred Action',        50),
  ('asylum',                  'Asylum',                        60),
  ('removal_defense',         'Removal Defense',               70),
  ('nonimmigrant_visa',       'Nonimmigrant Visa',             80),
  ('u_visa',                  'U Visa / VAWA',                 90),
  ('t_visa',                  'T Visa (Human Trafficking)',   100),
  ('employment_authorization','Employment Authorization',      110),
  ('other',                   'Other',                        999)
) AS ct(key, name, sort_order)
WHERE pa.key = 'immigration'
ON CONFLICT (practice_area_id, key) DO NOTHING;

-- â”€â”€ RLS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE public.practice_areas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.case_types             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enabled_practice_areas ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_family_law      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.client_immigration     ENABLE ROW LEVEL SECURITY;

-- Reference tables: readable by all authenticated users, writable by admins only
CREATE POLICY "practice_areas_select" ON public.practice_areas
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "case_types_select" ON public.case_types
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "enabled_practice_areas_select" ON public.enabled_practice_areas
  FOR SELECT TO authenticated USING (true);

-- Extension tables: firm staff read/write their own matters
CREATE POLICY "client_immigration_select" ON public.client_immigration
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "client_immigration_insert" ON public.client_immigration
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "client_immigration_update" ON public.client_immigration
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "client_immigration_delete" ON public.client_immigration
  FOR DELETE TO authenticated USING (true);

CREATE POLICY "client_family_law_select" ON public.client_family_law
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "client_family_law_insert" ON public.client_family_law
  FOR INSERT TO authenticated WITH CHECK (true);

CREATE POLICY "client_family_law_update" ON public.client_family_law
  FOR UPDATE TO authenticated USING (true);

CREATE POLICY "client_family_law_delete" ON public.client_family_law
  FOR DELETE TO authenticated USING (true);


-- ════════════════════════════════════════
-- 400_uploads_init.sql
-- ════════════════════════════════════════
-- Migration 400: Uploads module â€” document_checklists table + soft-delete on documents
-- Module: uploads | Branch: module/uploads | Range: 400-499
-- Apply AFTER migrations 001, 002, 003, 004.

-- ============================================================================
-- 1. SOFT-DELETE SUPPORT ON documents
--    The uploads module owns the document lifecycle. Soft-delete is correct for
--    a law firm (Texas retention â‰¥5 years). Hard-delete is Owner-only via the
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
-- 3. SEED â€” family-law standard document checklist (factory defaults)
--    Owner role can edit in-app via Settings â†’ Doc Templates.
-- ============================================================================

INSERT INTO public.document_checklists (case_type, doc_name, doc_category, description, is_required_by_default, sort_order) VALUES

  -- â”€â”€ Universal (all case types) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  (NULL, 'Photo ID (Driver''s License or Passport)',  'id',        'Government-issued photo ID',                                        true,   10),
  (NULL, 'Social Security Card',                      'id',        'Or documentation confirming SSN',                                   false,  20),
  (NULL, 'Financial Affidavit',                       'financial', 'Texas Family Code Form â€” income, expenses, assets, debts',          true,   30),
  (NULL, 'Last 3 months pay stubs',                   'financial', 'All employment income sources',                                     true,   40),
  (NULL, 'Last 2 years W-2 / 1099',                   'financial', 'All sources of income',                                             true,   50),
  (NULL, 'Last 2 years federal tax returns',           'financial', 'All pages including all schedules',                                 true,   60),
  (NULL, 'Last 3 months bank statements',             'financial', 'All accounts (checking, savings, money market)',                    true,   70),

  -- â”€â”€ Divorce â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  ('divorce', 'Marriage Certificate',                          'id',          'Original or certified copy',                             true,  100),
  ('divorce', 'Petition for Divorce',                          'pleading',    'Filed petition (certified if available)',                 true,  110),
  ('divorce', 'Decree of Divorce (draft/final)',               'agreement',   'Proposed or signed final decree',                        true,  120),
  ('divorce', 'Real estate deed(s) and mortgage statement(s)', 'financial',   'All real property â€” deed and current mortgage balance',  false, 130),
  ('divorce', 'Retirement account statements',                 'financial',   '401(k), IRA, pension â€” most recent statement',           false, 140),
  ('divorce', 'Vehicle titles',                                'financial',   'All vehicles marital or community property',             false, 150),
  ('divorce', 'QDRO (if applicable)',                          'court_order', 'Qualified Domestic Relations Order for retirement split', false, 160),
  ('divorce', 'Closing letter',                                'correspondence','Closing letter to client on matter conclusion',         true,  170),

  -- â”€â”€ SAPCR Original â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  ('sapcr_original', 'Original Petition (SAPCR)',              'pleading',    'Filed original suit affecting parent-child relationship', true,  200),
  ('sapcr_original', 'Birth certificate(s) â€” child(ren)',      'id',          'All children subject to the suit',                       true,  210),
  ('sapcr_original', 'SAPCR Final Order',                      'court_order', 'Signed final order for conservatorship and support',     true,  220),

  -- â”€â”€ SAPCR Modification â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  ('sapcr_modification', 'Existing SAPCR Order',               'court_order', 'Certified copy of the order being modified',             true,  300),
  ('sapcr_modification', 'Petition to Modify',                 'pleading',    'Filed modification petition',                            true,  310),
  ('sapcr_modification', 'Birth certificate(s) â€” child(ren)',  'id',          'All children subject to modification',                   true,  320),

  -- â”€â”€ Custody â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  ('custody', 'Birth certificate(s) â€” child(ren)',             'id',          'All children involved',                                  true,  400),
  ('custody', 'Existing custody order (if any)',               'court_order', 'Prior orders regarding conservatorship',                 false, 410),

  -- â”€â”€ Child Support â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  ('child_support', 'Birth certificate(s) â€” child(ren)',       'id',          'All children subject to support order',                  true,  500),
  ('child_support', 'Proof of paternity (if applicable)',       'court_order', 'AOP or paternity order',                                 false, 510),

  -- â”€â”€ Enforcement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  ('enforcement', 'Order being enforced',                      'court_order', 'Certified copy of the court order to enforce',           true,  600),
  ('enforcement', 'Motion for Enforcement',                    'pleading',    'Filed enforcement motion',                               true,  610),
  ('enforcement', 'Evidence of violation',                     'other',       'Bank records, communications, or other proof',           false, 620),

  -- â”€â”€ Protective Order â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  ('protective_order', 'Application for Protective Order',     'pleading',    'Filed application',                                      true,  700),
  ('protective_order', 'Police or incident report(s)',         'other',       'If available and relevant',                              false, 710),

  -- â”€â”€ Prenuptial Agreement â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  ('prenuptial_agreement', 'Prenuptial agreement draft',       'agreement',   'Initial draft for review',                               true,  800),
  ('prenuptial_agreement', 'Asset and liability schedule',     'financial',   'Full disclosure â€” both parties',                         true,  810);


-- ════════════════════════════════════════
-- 401_uploads_cron_cleanup.sql
-- ════════════════════════════════════════
-- Migration 401: Orphaned pending upload cleanup (pg_cron job)
-- Problem: if a browser closes after the R2 PUT succeeds but before confirm-upload
-- runs, the document row is stuck as status='pending' forever and appears as a ghost
-- in the missing-docs panel.
-- Solution: hourly pg_cron job soft-deletes pending rows older than 2 hours that are
-- not checklist placeholders (placeholders have r2_key starting with 'pending/').
--
-- pg_cron is available on Supabase Pro. This migration checks for the extension
-- before scheduling so it is safe to apply on the free-tier dev project too.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN

    -- Remove old job if it exists (idempotent re-run)
    PERFORM cron.unschedule('cleanup-orphaned-uploads')
      FROM cron.job WHERE jobname = 'cleanup-orphaned-uploads';

    PERFORM cron.schedule(
      'cleanup-orphaned-uploads',
      '0 * * * *',   -- every hour on the hour
      $cron$
        UPDATE public.documents
        SET    deleted_at = now()
        WHERE  status     = 'pending'
          AND  r2_key     NOT LIKE 'pending/%'   -- skip checklist placeholders
          AND  created_at < now() - interval '2 hours'
          AND  deleted_at IS NULL;
      $cron$
    );

    RAISE NOTICE 'pg_cron job "cleanup-orphaned-uploads" scheduled (hourly).';

  ELSE
    RAISE NOTICE 'pg_cron extension not found â€” skipping orphaned upload cleanup job. Enable pg_cron on Supabase Pro to activate this.';
  END IF;
END;
$$;


-- ════════════════════════════════════════
-- 402_ssn_encryption.sql
-- ════════════════════════════════════════
-- Migration 402: SSN last-4 columns + sensitive field audit log
--
-- ssn_last4 (4 chars, plaintext) lets the UI show â—â—â—â€“â—â—â€“XXXX without a
-- server round-trip on every page load.  Full SSN is only accessible via
-- the reveal-ssn Netlify function, which logs every read.
--
-- Apply AFTER migrations 001â€“004 and 400â€“401.

-- â”€â”€ ssn_last4 columns â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE public.clients                      ADD COLUMN IF NOT EXISTS ssn_last4 char(4);
ALTER TABLE public.opposing_parties             ADD COLUMN IF NOT EXISTS ssn_last4 char(4);
ALTER TABLE public.children                     ADD COLUMN IF NOT EXISTS ssn_last4 char(4);
ALTER TABLE public.children_other_relationships ADD COLUMN IF NOT EXISTS ssn_last4 char(4);

COMMENT ON COLUMN public.clients.ssn_last4                      IS 'Last 4 digits of SSN â€” plaintext, safe for display. Full SSN in ssn_encrypted.';
COMMENT ON COLUMN public.opposing_parties.ssn_last4             IS 'Last 4 digits of SSN â€” plaintext, safe for display.';
COMMENT ON COLUMN public.children.ssn_last4                     IS 'Last 4 digits of SSN â€” plaintext, safe for display.';
COMMENT ON COLUMN public.children_other_relationships.ssn_last4 IS 'Last 4 digits of SSN â€” plaintext, safe for display.';

-- â”€â”€ Sensitive field audit log â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Logs every write (save) and read (reveal) of encrypted fields.
-- Inserted by server-side functions using the service_role key (bypasses RLS).
-- Readable by any portal user with write-level core access.

CREATE TABLE IF NOT EXISTS public.sensitive_field_audit (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  entity_type  text        NOT NULL,   -- 'clients' | 'opposing_parties' | 'children' | 'children_other_relationships'
  entity_id    uuid        NOT NULL,
  field_name   text        NOT NULL DEFAULT 'ssn',
  action       text        NOT NULL CHECK (action IN ('write', 'read')),
  performed_by uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  ip_address   text
);

CREATE INDEX IF NOT EXISTS idx_ssn_audit_entity ON public.sensitive_field_audit (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_ssn_audit_user   ON public.sensitive_field_audit (performed_by);
CREATE INDEX IF NOT EXISTS idx_ssn_audit_time   ON public.sensitive_field_audit (created_at DESC);

ALTER TABLE public.sensitive_field_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit_insert" ON public.sensitive_field_audit
  FOR INSERT WITH CHECK (public.can_write('core'));

CREATE POLICY "audit_select" ON public.sensitive_field_audit
  FOR SELECT USING (public.can_write('core'));


-- ════════════════════════════════════════
-- 403_malware_scanning.sql
-- ════════════════════════════════════════
-- Migration 403: Malware scanning columns on documents
-- Module: uploads | Range: 400-499
--
-- Uploads are scanned in confirm-upload (after the browser PUTs to R2, before
-- the document ever becomes visible/downloadable). Scanner: attachmentAV
-- (Sophos engine) â€” the Worker hands it a short-lived presigned R2 GET URL via
-- the synchronous /v1/scan/sync/download endpoint; file bytes never flow
-- through the Worker and attachmentAV deletes them immediately after scanning.
--
-- scan_status values:
--   pending   â€” not yet scanned (default; also restored on an infected
--               checklist fulfillment so the placeholder can be re-used)
--   clean     â€” scanner verdict: clean
--   infected  â€” scanner verdict: infected. File deleted from R2; freeform
--               uploads are soft-deleted (the row is the quarantine record),
--               checklist fulfillments revert to placeholder state.
--   skipped   â€” scanner unreachable / not configured / file unscannable
--               (e.g. password-protected). Upload allowed (graceful
--               degradation); reason recorded in scan_detail.
--
-- Apply AFTER migrations 400-402.

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS scan_status text NOT NULL DEFAULT 'pending'
  CHECK (scan_status IN ('pending', 'clean', 'infected', 'skipped'));
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS scan_detail jsonb;
ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS scanned_at  timestamptz;

COMMENT ON COLUMN public.documents.scan_status IS 'Malware scan verdict: pending | clean | infected | skipped.';
COMMENT ON COLUMN public.documents.scan_detail IS 'Scanner verdict detail: provider, finding, real file type, or skip/error reason.';
COMMENT ON COLUMN public.documents.scanned_at  IS 'When the scan verdict was recorded.';

-- Quarantined uploads: find them even though they are soft-deleted.
CREATE INDEX IF NOT EXISTS idx_documents_scan_infected
  ON public.documents (scanned_at)
  WHERE scan_status = 'infected';


-- ════════════════════════════════════════
-- 500_esign_init.sql
-- ════════════════════════════════════════
-- Migration 500: E-sign module â€” initial schema
-- Module: esign | Branch: module/esign
-- Number range for this module: 500â€“599
-- Apply AFTER migrations 001â€“005 (core schema, RBAC, RLS, uploads, client portal).

-- â”€â”€ TABLES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

-- Signature requests: one row per document sent for signing.
-- Supports 1-signer (client only) and 2-signer (client â†’ attorney counter-sign).
CREATE TABLE public.signature_requests (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id           uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  matter_id             uuid NOT NULL REFERENCES public.matters(id)   ON DELETE CASCADE,
  requested_by          uuid NOT NULL REFERENCES public.users(id),
  status                text NOT NULL DEFAULT 'pending_client'
                          CHECK (status IN ('pending_client','pending_attorney','completed','declined','expired')),
  requires_countersign  boolean NOT NULL DEFAULT true,
  token                 text NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  message               text,
  expires_at            timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Individual signature events: one row per signer.
CREATE TABLE public.signatures (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  signature_request_id     uuid NOT NULL REFERENCES public.signature_requests(id) ON DELETE CASCADE,
  signer_user_id           uuid REFERENCES public.users(id),
  signer_client_id         uuid REFERENCES public.clients(id),
  signer_role              text NOT NULL CHECK (signer_role IN ('client','attorney')),
  signed_at                timestamptz NOT NULL DEFAULT now(),
  ip_address               text,
  user_agent               text,
  document_hash_before     text NOT NULL,
  document_hash_after      text,
  signature_image          text NOT NULL,
  audit_log                jsonb NOT NULL DEFAULT '{}'
);

CREATE INDEX ON public.signature_requests (document_id);
CREATE INDEX ON public.signature_requests (matter_id);
CREATE INDEX ON public.signature_requests (status);
CREATE INDEX ON public.signatures (signature_request_id);

CREATE OR REPLACE FUNCTION public.set_esign_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER signature_requests_updated_at
  BEFORE UPDATE ON public.signature_requests
  FOR EACH ROW EXECUTE FUNCTION public.set_esign_updated_at();

-- â”€â”€ MODULE REGISTRATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.modules (key, name, description)
VALUES ('esign', 'E-Sign', 'Request and capture legally-binding e-signatures with SHA-256 audit trail')
ON CONFLICT (key) DO NOTHING;

-- â”€â”€ RLS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE public.signature_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.signatures         ENABLE ROW LEVEL SECURITY;

CREATE POLICY "esign_requests_staff_select"
  ON public.signature_requests FOR SELECT
  USING (public.can_read('esign'));

CREATE POLICY "esign_requests_staff_write"
  ON public.signature_requests FOR ALL
  USING (public.can_write('esign'));

-- Clients see their own requests via matter linkage
CREATE POLICY "esign_requests_client_select"
  ON public.signature_requests FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.clients c
        JOIN public.matters m ON m.client_id = c.id
      WHERE c.auth_id = auth.uid()
        AND m.id = signature_requests.matter_id
    )
  );

CREATE POLICY "esign_signatures_staff_select"
  ON public.signatures FOR SELECT
  USING (public.can_read('esign'));

CREATE POLICY "esign_signatures_staff_write"
  ON public.signatures FOR ALL
  USING (public.can_write('esign'));

CREATE POLICY "esign_signatures_client_select"
  ON public.signatures FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.signature_requests sr
        JOIN public.matters m ON m.id = sr.matter_id
        JOIN public.clients c ON c.id = m.client_id
      WHERE sr.id = signatures.signature_request_id
        AND c.auth_id = auth.uid()
    )
  );


-- ════════════════════════════════════════
-- 501_esign_access.sql
-- ════════════════════════════════════════
-- Migration 501: esign module â€” seed role_module_access
-- Grants write access to Owner, Attorney, Partner Attorney, Staff Admin.
-- Read access to Paralegal (can view requests, not create them).

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'esign', 'admin' FROM public.roles r WHERE r.name = 'Owner'
ON CONFLICT (role_id, module_key) DO UPDATE SET access_level = 'admin';

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'esign', 'write' FROM public.roles r WHERE r.name IN ('Attorney', 'Partner Attorney', 'Staff Admin')
ON CONFLICT (role_id, module_key) DO UPDATE SET access_level = 'write';

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'esign', 'read' FROM public.roles r WHERE r.name = 'Paralegal'
ON CONFLICT (role_id, module_key) DO UPDATE SET access_level = 'read';


-- ════════════════════════════════════════
-- 502_esign_paralegal_write.sql
-- ════════════════════════════════════════
-- Migration 502: upgrade Paralegal esign access from read â†’ write
-- Texas law allows all firm staff (including paralegals) to send e-sign requests.
-- Counter-signing remains attorney-only (enforced in sign-document.js, not here).

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'esign', 'write' FROM public.roles r WHERE r.name = 'Paralegal'
ON CONFLICT (role_id, module_key) DO UPDATE SET access_level = 'write';


-- ════════════════════════════════════════
-- 600_conflict_checker.sql
-- ════════════════════════════════════════
-- Migration 600: Conflict checker module
-- Adds conflict_checks audit table and registers the module for staff access.
-- "Conflict check" = checking whether the firm has prior/current relationships
--  with a prospective new client or their opposing party (conflict of interest).
-- Apply AFTER migrations 001â€“003.

-- ============================================================================
-- 1. AUDIT TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.conflict_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  checked_at   timestamptz NOT NULL DEFAULT now(),
  checked_by   uuid REFERENCES public.users(id) ON DELETE SET NULL,

  -- Names searched
  prospective_client_name  text NOT NULL,
  opposing_party_name      text,
  additional_names         text[],

  -- Snapshot of search results (for audit trail)
  matches_found            jsonb NOT NULL DEFAULT '[]',

  -- Staff decision
  outcome   text CHECK (outcome IN ('clear', 'conflict', 'review_needed')),
  notes     text,

  -- Optional link once client is accepted
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL
);

CREATE INDEX idx_conflict_checks_by   ON public.conflict_checks (checked_by);
CREATE INDEX idx_conflict_checks_at   ON public.conflict_checks (checked_at DESC);
CREATE INDEX idx_conflict_checks_name ON public.conflict_checks
  USING gin (to_tsvector('simple', prospective_client_name));

ALTER TABLE public.conflict_checks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "conflict_checks_select" ON public.conflict_checks
  FOR SELECT USING (public.can_read('core'));

CREATE POLICY "conflict_checks_write" ON public.conflict_checks
  FOR ALL USING (public.can_write('core'));

-- ============================================================================
-- 2. MODULE REGISTRATION
-- ============================================================================

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default)
VALUES (
  'conflict_checker',
  'Conflict Check',
  'Search for conflicts of interest before accepting a new client.',
  'shield',
  'conflict-checker',
  1,
  25,
  true
)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 3. ROLE ACCESS â€” all staff roles except Client
-- ============================================================================

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT id, 'conflict_checker', 'write'
FROM public.roles
WHERE name != 'Client'
ON CONFLICT (role_id, module_key) DO NOTHING;


-- ════════════════════════════════════════
-- 700_attorney_color.sql
-- ════════════════════════════════════════
-- Migration 700: Attorney color coding
-- Adds a hex color to staff user records for visual identification in the portal.
-- Displayed as a colored dot next to attorney names in the client list.
-- Apply in any order after migration 002.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS color text DEFAULT NULL;

COMMENT ON COLUMN public.users.color IS
  'Hex color string (e.g. #3B82F6) for visual identification in client list. Owner/admin sets in Settings > Users.';


-- ════════════════════════════════════════
-- 800_messaging.sql
-- ════════════════════════════════════════
-- Migration 800: Messaging module (v1 â€” portal channel + email notifications)
-- Two tables: conversations (one per client) + messages (channel-aware).
-- Twilio channels (sms, whatsapp, email) are schema-ready but not wired yet.
-- Apply AFTER migrations 001â€“006 and 500â€“502.

-- â”€â”€ CONVERSATIONS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE public.conversations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id)  -- one conversation thread per client
);

CREATE INDEX idx_conversations_client_id   ON public.conversations(client_id);
CREATE INDEX idx_conversations_last_msg    ON public.conversations(last_message_at DESC);

-- â”€â”€ MESSAGES â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE public.messages (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID        NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  direction       TEXT        NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  channel         TEXT        NOT NULL DEFAULT 'portal'
                              CHECK (channel IN ('portal', 'sms', 'whatsapp', 'email')),
  body            TEXT        NOT NULL CHECK (char_length(trim(body)) > 0),
  sender_id       UUID        REFERENCES public.users(id) ON DELETE SET NULL,
  read_at         TIMESTAMPTZ,        -- when staff marked inbound message read
  client_read_at  TIMESTAMPTZ,        -- when client viewed outbound message
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_messages_conversation     ON public.messages(conversation_id, created_at);
CREATE INDEX idx_messages_unread_inbound   ON public.messages(conversation_id, read_at)
  WHERE direction = 'inbound' AND read_at IS NULL;

-- â”€â”€ RLS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages      ENABLE ROW LEVEL SECURITY;

-- Staff: full access via module permissions
CREATE POLICY "convos_staff_select" ON public.conversations
  FOR SELECT USING (public.can_read('messaging'));

CREATE POLICY "convos_staff_insert" ON public.conversations
  FOR INSERT WITH CHECK (public.can_write('messaging'));

CREATE POLICY "convos_staff_update" ON public.conversations
  FOR UPDATE USING (public.can_write('messaging'));

-- Clients: only their own conversation (additive â€” ORed with staff policy)
CREATE POLICY "convos_client_select" ON public.conversations
  FOR SELECT USING (client_id = public.my_client_id());

-- Messages â€” staff
CREATE POLICY "msgs_staff_select" ON public.messages
  FOR SELECT USING (public.can_read('messaging'));

CREATE POLICY "msgs_staff_insert" ON public.messages
  FOR INSERT WITH CHECK (public.can_write('messaging'));

CREATE POLICY "msgs_staff_update" ON public.messages
  FOR UPDATE USING (public.can_write('messaging'));

-- Messages â€” client sees only their own conversation's messages
CREATE POLICY "msgs_client_select" ON public.messages
  FOR SELECT USING (
    conversation_id IN (
      SELECT id FROM public.conversations WHERE client_id = public.my_client_id()
    )
  );

-- Client can insert inbound portal messages only
CREATE POLICY "msgs_client_insert" ON public.messages
  FOR INSERT WITH CHECK (
    direction = 'inbound'
    AND channel = 'portal'
    AND conversation_id IN (
      SELECT id FROM public.conversations WHERE client_id = public.my_client_id()
    )
  );

-- â”€â”€ MODULE REGISTRATION â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default)
VALUES (
  'messaging',
  'Messages',
  'Two-way messaging with clients via the portal and email notifications.',
  'message-circle',
  'messaging',
  1,
  4,
  true
)
ON CONFLICT (key) DO NOTHING;

-- â”€â”€ ROLE ACCESS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Uses SELECT approach so missing roles are silently skipped (safe on any instance).

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id,
       'messaging',
       CASE r.name
         WHEN 'Owner'            THEN 'admin'::public.access_level
         WHEN 'Attorney'         THEN 'write'::public.access_level
         WHEN 'Partner Attorney' THEN 'write'::public.access_level
         WHEN 'Paralegal'        THEN 'write'::public.access_level
         WHEN 'Legal Assistant'  THEN 'read'::public.access_level
         WHEN 'Client'           THEN 'write'::public.access_level
       END
FROM public.roles r
WHERE r.name IN ('Owner','Attorney','Partner Attorney','Paralegal','Legal Assistant','Client')
ON CONFLICT (role_id, module_key) DO NOTHING;


-- ════════════════════════════════════════
-- 901_doc_discovery.sql
-- ════════════════════════════════════════
-- Migration 901: Document Discovery â€” offline receipt tracking + reminder infrastructure
-- Extends the documents + matters tables. document_checklists already seeded in 400.
-- Apply AFTER migrations 001â€“800.

-- â”€â”€ Add columns to documents â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS received_note    TEXT,
  ADD COLUMN IF NOT EXISTS received_by      UUID REFERENCES public.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS last_reminded_at TIMESTAMPTZ;

-- â”€â”€ Add reminder cadence to matters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE public.matters
  ADD COLUMN IF NOT EXISTS reminder_interval_days INT NOT NULL DEFAULT 7;

-- â”€â”€ Module registration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default)
VALUES (
  'doc_templates',
  'Doc Templates',
  'Configure required document checklists per case type.',
  'file-text',
  'settings/doc-templates',
  1,
  85,
  true
)
ON CONFLICT (key) DO NOTHING;

-- Owner + Attorney manage templates; Paralegal/Legal Assistant read-only
INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'doc_templates',
  CASE r.name
    WHEN 'Owner'            THEN 'admin'::public.access_level
    WHEN 'Attorney'         THEN 'write'::public.access_level
    WHEN 'Partner Attorney' THEN 'write'::public.access_level
    WHEN 'Paralegal'        THEN 'read'::public.access_level
    WHEN 'Legal Assistant'  THEN 'read'::public.access_level
  END
FROM public.roles r
WHERE r.name IN ('Owner','Attorney','Partner Attorney','Paralegal','Legal Assistant')
ON CONFLICT (role_id, module_key) DO NOTHING;


-- ════════════════════════════════════════
-- 902_doc_template_case_types.sql
-- ════════════════════════════════════════
-- Migration 902: Document template multi-case-type support
-- Adds case_types text[] to document_checklists.
-- NULL = universal (all case types). Array = applies to listed types only.
-- Backfills existing rows from the single case_type column.
-- The old case_type column is left in place for safety but is no longer written by the app.

ALTER TABLE public.document_checklists
  ADD COLUMN IF NOT EXISTS case_types text[];

-- Backfill: specific-type rows get a single-element array
UPDATE public.document_checklists
  SET case_types = ARRAY[case_type::text]
  WHERE case_type IS NOT NULL;

-- Universal rows (case_type IS NULL) remain with case_types = NULL â†’ still universal.


-- ════════════════════════════════════════
-- 950_dashboard.sql
-- ════════════════════════════════════════
-- Migration 950: Dashboard module â€” activate + extend access to later-added roles
-- The dashboard module row was seeded in migration 002 as 'Analytics' (disabled).
-- This migration renames it, moves it first in nav, enables it by default, and
-- grants access to Partner Attorney + Legal Assistant (added after the 002 seed).
-- Apply AFTER migrations 001â€“901.

-- Activate the module and rename it
UPDATE public.modules
SET
  name               = 'Dashboard',
  description        = 'Morning triage view â€” overdue tasks, missing docs, unread messages, pending signatures.',
  sort_order         = 1,
  enabled_by_default = true
WHERE key = 'dashboard';

-- Extend access to roles added after the migration 002 seed
INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'dashboard',
  CASE r.name
    WHEN 'Partner Attorney' THEN 'read'::public.access_level
    WHEN 'Legal Assistant'  THEN 'read'::public.access_level
    ELSE                         'none'::public.access_level
  END
FROM public.roles r
WHERE r.name IN ('Partner Attorney', 'Legal Assistant')
ON CONFLICT (role_id, module_key) DO UPDATE SET access_level = EXCLUDED.access_level;


-- ════════════════════════════════════════
-- 1000_calendar_oauth.sql
-- ════════════════════════════════════════
-- Migration 1000: Calendar module â€” Google (and future Microsoft) OAuth integration
-- Stores per-user OAuth tokens and short-lived CSRF state for the OAuth redirect flow.
-- Apply AFTER migrations 001â€“003.

-- ============================================================================
-- 1. OAUTH TOKEN STORAGE
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.oauth_tokens (
  id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider      text         NOT NULL CHECK (provider IN ('google', 'microsoft')),
  access_token  text,
  refresh_token text         NOT NULL,
  token_expiry  timestamptz,
  account_email text,
  created_at    timestamptz  DEFAULT now(),
  updated_at    timestamptz  DEFAULT now(),
  UNIQUE(user_id, provider)
);

CREATE INDEX idx_oauth_tokens_user ON public.oauth_tokens (user_id);

ALTER TABLE public.oauth_tokens ENABLE ROW LEVEL SECURITY;
-- Service key only â€” no client-facing RLS needed

-- ============================================================================
-- 2. OAUTH STATE (CSRF protection for redirect flow)
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.oauth_state (
  state      text         PRIMARY KEY,
  user_id    uuid         NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider   text         NOT NULL DEFAULT 'google',
  expires_at timestamptz  NOT NULL DEFAULT (now() + interval '10 minutes')
);

ALTER TABLE public.oauth_state ENABLE ROW LEVEL SECURITY;
-- Service key only

-- ============================================================================
-- 3. MODULE REGISTRATION
-- ============================================================================

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default)
VALUES (
  'calendar',
  'Calendar',
  'Google Calendar integration â€” view and create events from the portal.',
  'calendar',
  'calendar',
  1,
  45,
  false
)
ON CONFLICT (key) DO NOTHING;

-- ============================================================================
-- 4. ROLE ACCESS â€” all staff (not Client); premium module, disabled by default
-- ============================================================================

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT id, 'calendar', 'write'
FROM public.roles
WHERE name != 'Client'
ON CONFLICT (role_id, module_key) DO NOTHING;


-- ════════════════════════════════════════
-- 1001_calendar_key_dates.sql
-- ════════════════════════════════════════
-- Migration 1001: Link key_dates to Google Calendar events
-- Adds google_event_id so staff can track which key dates have been pushed to Google Calendar.

ALTER TABLE public.key_dates
  ADD COLUMN IF NOT EXISTS google_event_id TEXT;


-- ════════════════════════════════════════
-- 1002_calendar_outlook_provider.sql
-- ════════════════════════════════════════
-- Migration 1002: Fix oauth_tokens provider check constraint.
-- The original migration used 'microsoft' but all code uses 'outlook'. Align the constraint.

ALTER TABLE public.oauth_tokens
  DROP CONSTRAINT IF EXISTS oauth_tokens_provider_check;

ALTER TABLE public.oauth_tokens
  ADD CONSTRAINT oauth_tokens_provider_check
  CHECK (provider IN ('google', 'outlook'));


-- ════════════════════════════════════════
-- 1003_messaging_debounced_notifications.sql
-- ════════════════════════════════════════
-- Migration 1003: add client_notified_at to conversations
-- Enables debounced email notifications â€” cron checks this to avoid re-notifying
-- for messages that were already batched into a prior email.

ALTER TABLE public.conversations
  ADD COLUMN IF NOT EXISTS client_notified_at TIMESTAMPTZ;


-- ════════════════════════════════════════
-- 1050_enabled_modules.sql
-- ════════════════════════════════════════
-- Migration 1050: IurisIQ tier model
-- Adds modules.tier column (core | premium) and enabled_modules table.
-- Premium modules are off by default; a row in enabled_modules activates them per firm.
-- Applied: dev â˜  prod â˜

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 1. ADD tier COLUMN TO modules
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE public.modules
  ADD COLUMN IF NOT EXISTS tier text NOT NULL DEFAULT 'core'
  CHECK (tier IN ('core', 'premium'));

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 2. SET TIER FOR ALL EXISTING MODULES
--    core: core, tasks, uploads, client_portal, doc_templates, dashboard
--    premium: everything else (messaging, esign, conflict_checker, calendar,
--             billing, ai_brain, draft_forms, word_embed)
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

UPDATE public.modules
SET tier = 'premium'
WHERE key IN (
  'messaging',
  'esign',
  'conflict_checker',
  'calendar',
  'billing',
  'ai_brain',
  'draft_forms',
  'word_embed'
);

-- core/tasks/uploads/client_portal/doc_templates/dashboard keep DEFAULT 'core'

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 3. CREATE enabled_modules TABLE
--    One row per active premium module for this firm.
--    For multi-tenant future: add firm_id column here before template extraction.
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE IF NOT EXISTS public.enabled_modules (
  module_key   text        PRIMARY KEY REFERENCES public.modules(key) ON DELETE CASCADE,
  enabled_at   timestamptz NOT NULL DEFAULT now(),
  enabled_by   uuid        REFERENCES public.users(id) ON DELETE SET NULL
);

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 4. ROW-LEVEL SECURITY
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE public.enabled_modules ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read (menu.js needs this to build the nav)
CREATE POLICY "authenticated can read enabled_modules"
  ON public.enabled_modules FOR SELECT
  USING (auth.uid() IS NOT NULL);

-- Only Owners can add / remove enabled modules
CREATE POLICY "owners can manage enabled_modules"
  ON public.enabled_modules FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.roles r ON u.role_id = r.id
      WHERE u.auth_id = auth.uid() AND r.name = 'Owner'
    )
  );

-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- 5. SEED â€” enable built premium modules for this deployment
--    Edit this list to match what the client has purchased.
--    comingSoon modules (billing, ai_brain, draft_forms, word_embed) excluded until built.
-- â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.enabled_modules (module_key) VALUES
  ('messaging'),
  ('esign'),
  ('conflict_checker'),
  ('calendar')
ON CONFLICT (module_key) DO NOTHING;


-- ════════════════════════════════════════
-- 1103_email_log.sql
-- ════════════════════════════════════════
-- 1103_email_log.sql
-- Tracks every outbound email sent via Resend for monitoring purposes.
-- Logged server-side via service key; staff can read via portal monitoring page.

CREATE TABLE IF NOT EXISTS public.email_log (
  id         UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  type       TEXT        NOT NULL,
  to_email   TEXT        NOT NULL,
  subject    TEXT,
  status     TEXT        NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed')),
  error      TEXT
);

ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff read email_log" ON public.email_log
  FOR SELECT USING (can_read('core'));


-- ════════════════════════════════════════
-- 1104_ical_token.sql
-- ════════════════════════════════════════
-- Migration 1104: iCal feed token per user
-- Each user gets a secret UUID token; the feed URL is /api/calendar/ical-feed?token=<uuid>
-- The token is stable (survives server restarts) and can be regenerated to invalidate old URLs.
-- Apply AFTER migration 1103.

ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS ical_token UUID DEFAULT gen_random_uuid();

-- Populate existing users who got NULL (shouldn't happen with DEFAULT, but just in case)
UPDATE public.users SET ical_token = gen_random_uuid() WHERE ical_token IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_users_ical_token ON public.users (ical_token);


-- ════════════════════════════════════════
-- 1105_practice_areas_backfill.sql
-- ════════════════════════════════════════
-- Migration 1105: Backfill practice_area_id and case_type_id on existing matters
-- Maps old case_type text values to the new FK columns added in 007_practice_areas.sql.
-- Safe to run multiple times (WHERE clause skips already-migrated rows).
-- Also enables both practice areas in the sandbox.

-- Enable practice areas for this deployment
INSERT INTO public.enabled_practice_areas (practice_area_key)
  VALUES ('family_law'), ('immigration')
ON CONFLICT DO NOTHING;

-- Backfill matters that have an old case_type text value
UPDATE public.matters m
SET
  case_type_id     = ct.id,
  practice_area_id = ct.practice_area_id
FROM public.case_types ct
WHERE m.case_type = ct.key
  AND (m.case_type_id IS NULL OR m.practice_area_id IS NULL);


-- ════════════════════════════════════════
-- 1106_doc_drafting.sql
-- ════════════════════════════════════════
-- Migration 1106: Document Drafting Module
-- HTML-based approach: templates stored as template_html in DB, rendered server-side.
-- No Word/WebDAV/R2 dependency â€” works in any browser, print-to-PDF ready.

-- â”€â”€ Extend matters â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE public.matters
  ADD COLUMN IF NOT EXISTS court_number      text,
  ADD COLUMN IF NOT EXISTS date_of_marriage  date;

-- â”€â”€ draft_templates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE IF NOT EXISTS public.draft_templates (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  name          text        NOT NULL,
  description   text,
  doc_category  text        NOT NULL DEFAULT 'other'
                CHECK (doc_category IN ('petition','letter','agreement','order','financial','other')),
  case_types    text[],
  template_html text        NOT NULL,
  wizard_schema jsonb       NOT NULL DEFAULT '[]',
  sort_order    int         NOT NULL DEFAULT 0,
  active        boolean     NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_draft_templates_category ON public.draft_templates (doc_category);

CREATE TRIGGER set_draft_templates_updated_at
  BEFORE UPDATE ON public.draft_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- â”€â”€ draft_documents â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE IF NOT EXISTS public.draft_documents (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at    timestamptz NOT NULL DEFAULT now(),
  matter_id     uuid        NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  template_id   uuid        NOT NULL REFERENCES public.draft_templates(id) ON DELETE RESTRICT,
  generated_by  uuid        REFERENCES public.users(id) ON DELETE SET NULL,
  wizard_data   jsonb       NOT NULL DEFAULT '{}',
  file_name     text        NOT NULL,
  is_final      boolean     NOT NULL DEFAULT false,
  finalized_at  timestamptz,
  finalized_by  uuid        REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_draft_docs_matter ON public.draft_documents (matter_id);

-- â”€â”€ RLS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE public.draft_templates  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.draft_documents  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "draft_tmpl_read"  ON public.draft_templates FOR SELECT USING (can_read('core'));
CREATE POLICY "draft_tmpl_write" ON public.draft_templates FOR ALL    USING (can_write('core'));

CREATE POLICY "draft_docs_read"  ON public.draft_documents FOR SELECT USING (can_read('core'));
CREATE POLICY "draft_docs_write" ON public.draft_documents FOR ALL    USING (can_write('core'));

-- â”€â”€ Module registration â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default)
VALUES ('doc_drafting', 'Document Drafting', 'Generate court documents from client data.', 'file-plus', 'drafting', 1, 87, true)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'doc_drafting',
  CASE r.name
    WHEN 'Owner'            THEN 'admin'::public.access_level
    WHEN 'Attorney'         THEN 'write'::public.access_level
    WHEN 'Partner Attorney' THEN 'write'::public.access_level
    WHEN 'Paralegal'        THEN 'write'::public.access_level
    WHEN 'Legal Assistant'  THEN 'read'::public.access_level
  END
FROM public.roles r
WHERE r.name IN ('Owner','Attorney','Partner Attorney','Paralegal','Legal Assistant')
ON CONFLICT (role_id, module_key) DO NOTHING;

-- â”€â”€ Seed: Original Petition for Divorce â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.draft_templates (name, doc_category, case_types, description, sort_order, template_html, wizard_schema)
VALUES (
  'Original Petition for Divorce',
  'petition',
  ARRAY['divorce'],
  'Standard Texas Original Petition for Divorce. Covers parties, domicile, service, jurisdiction, grounds, children, and prayer.',
  10,
$TEMPLATE$<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Original Petition for Divorce</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: 'Times New Roman', Times, serif; font-size: 12pt; line-height: 1.6; margin: 1in; color: #000; max-width: 850px; }
  .caption-court { text-align: center; margin-bottom: 6pt; }
  .caption-table { width: 100%; border-collapse: collapse; margin-bottom: 20pt; }
  .caption-table td { padding: 1pt 4pt; vertical-align: top; line-height: 1.4; }
  .caption-party { width: 44%; }
  .caption-sec { width: 6%; text-align: center; font-size: 13pt; }
  .caption-cause { width: 50%; padding-left: 12pt; }
  .doc-title { text-align: center; font-weight: bold; text-decoration: underline; font-size: 13pt; margin: 16pt 0 20pt; letter-spacing: 0.5px; }
  body { counter-reset: art; }
  .art-header { font-weight: bold; }
  .art-header::before { counter-increment: art; content: counter(art) ". "; }
  p { margin: 10pt 0; text-align: justify; }
  .children-table { width: 100%; border-collapse: collapse; margin: 8pt 0 8pt 20pt; }
  .children-table td { padding: 3pt 8pt; font-size: 11.5pt; }
  .children-table tr:not(:last-child) { border-bottom: 1px solid #ccc; }
  .sig-line { border-top: 1px solid #000; width: 260pt; margin: 40pt 0 4pt; }
  .sig-name { font-size: 11.5pt; }
  .notice { background: #fff8e1; border: 1px solid #f59e0b; padding: 8pt 12pt; margin-bottom: 16pt; font-size: 10.5pt; border-radius: 4px; }
  @media print { .notice { display:none; } body { margin: 0.75in; } @page { margin: 0.75in; } }
</style>
</head>
<body>

<div class="notice">&#x26A0; Review all bracketed placeholders before filing. This document was auto-generated â€” attorney review required.</div>

<div class="caption-court">IN THE {{court_number}} DISTRICT COURT<br>{{court_county}} COUNTY, TEXAS</div>

<table class="caption-table">
<tr>
  <td class="caption-party">{{petitioner_name}},<br>&nbsp;&nbsp;&nbsp;&nbsp;Petitioner,</td>
  <td class="caption-sec">&#167;<br>&#167;<br>&#167;</td>
  <td class="caption-cause" rowspan="5">CAUSE NO. {{case_number}}</td>
</tr>
<tr>
  <td style="padding-left:0">v.</td>
  <td class="caption-sec">&#167;</td>
</tr>
<tr>
  <td class="caption-party">{{respondent_name}},<br>&nbsp;&nbsp;&nbsp;&nbsp;Respondent.</td>
  <td class="caption-sec">&#167;<br>&#167;<br>&#167;</td>
</tr>
</table>

<div class="doc-title">ORIGINAL PETITION FOR DIVORCE</div>

<p><strong class="art-header">Discovery.</strong> Discovery in this case is intended to be conducted under {{discovery_label}} of Rule 190 of the Texas Rules of Civil Procedure.{{#if discovery_no_children_note}} No children are involved in this divorce case, and the value of the marital estate is more than zero but not more than $250,000.{{/if}}</p>

<p>Preservation of Evidence: Respondent is put on notice to preserve and not destroy, conceal, or alter any evidence or potential evidence relevant to the issues in this case, including tangible documents or items in Respondent's possession or subject to Respondent's control and electronic documents, files, or other data generated by or stored on Respondent's home computer, work computer, storage media, portable systems, electronic devices, online repositories, or cell phone.</p>

{{#if object_to_associate_judge}}
<p><strong class="art-header">Objection to Assignment of Case to Associate Judge.</strong> Petitioner objects to the assignment of this matter to an associate judge for a trial on the merits or presiding at a jury trial.</p>
{{/if}}

<p><strong class="art-header">Parties.</strong> This suit is brought by {{petitioner_name}}, Petitioner.{{#if petitioner_has_dl}} The last three numbers of Petitioner's driver's license number are {{petitioner_dl_last3}}.{{/if}}{{^petitioner_has_dl}} Petitioner has not been issued a driver's license.{{/petitioner_has_dl}}{{#if petitioner_has_ssn}} The last three numbers of Petitioner's Social Security number are {{petitioner_ssn_last3}}.{{/if}}{{^petitioner_has_ssn}} Petitioner has not been issued a Social Security number.{{/petitioner_has_ssn}}</p>

<p>{{respondent_name}} is Respondent.</p>

<p><strong class="art-header">Domicile.</strong> {{#if petitioner_tx_domiciliary}}{{petitioner_name}} has been a domiciliary of Texas for the preceding six-month period and a resident of this county for the preceding ninety-day period.{{/if}}{{^petitioner_tx_domiciliary}}Petitioner is domiciled in another state or nation. Respondent has been a domiciliary of Texas for at least the last six months and is a resident of this county.{{/petitioner_tx_domiciliary}}</p>

<p><strong class="art-header">Service.</strong> {{#if service_personal}}Process should be served on Respondent at {{respondent_full_address}}.{{/if}}{{#if service_none}}No service on Respondent is necessary at this time.{{/if}}{{#if service_substituted}}Citation of Respondent by publication or other substituted service is necessary for the reasons stated in the affidavit attached as Exhibit A.{{/if}}</p>

<p><strong class="art-header">Jurisdiction.</strong> The subject matter in controversy is within the jurisdictional limits of this court.</p>

<p>Petitioner seeks: {{relief_text}}.</p>

<p><strong class="art-header">Protective Order Statement.</strong> No protective order under title 4 of the Texas Family Code, protective order under subchapter A of chapter 7B of the Texas Code of Criminal Procedure, or order for emergency protection under Article 17.292 of the Texas Code of Criminal Procedure is in effect in regard to a party to this suit{{#if has_children}} or a child of a party to this suit{{/if}} and no application for any such order is pending.</p>

<p><strong class="art-header">Dates of Marriage and Separation.</strong> The parties were married on or about {{marriage_date_display}} and ceased to live together as spouses on or about {{separation_date_display}}.</p>

<p><strong class="art-header">Grounds for Divorce.</strong> {{grounds_text}}</p>

<p><strong class="art-header">Children of the Marriage.</strong>
{{^has_children}}There is no child born or adopted of this marriage, and none is expected.{{/has_children}}
{{#if has_children}}Petitioner and Respondent are parents of the following {{children_noun}} of this marriage:
<table class="children-table">
<tr><td><strong>Name</strong></td><td><strong>Date of Birth</strong></td><td><strong>Sex</strong></td></tr>
{{#each children}}<tr><td>{{name}}</td><td>{{dob_display}}</td><td>{{sex_label}}</td></tr>
{{/each}}
</table>
{{#if conservatorship_jmc}}Petitioner and Respondent, on final hearing, should be appointed joint managing conservators.{{#if conservatorship_petitioner_primary}} Petitioner should be designated as the conservator who has the exclusive right to designate the primary residence of the {{children_noun}}.{{/if}} Respondent should be ordered to provide support for the {{children_noun}}, including the payment of child support and medical and dental support in the manner specified by the Court. Petitioner requests that the payments for the support of the {{children_noun}} survive the death of Respondent and become the obligations of Respondent's estate.{{/if}}{{#if conservatorship_sole}}The appointment of Petitioner and Respondent as joint managing conservators would not be in the best interest of the {{children_noun}}. Petitioner, on final hearing, should be appointed sole managing conservator, with all the rights and duties of a parent sole managing conservator, and Respondent should be ordered to provide support for the {{children_noun}}, including the payment of child support and medical and dental support in the manner specified by the Court.{{/if}}{{#if conservatorship_possessory}}Petitioner should be appointed possessory conservator with all the rights and duties of a parent conservator. Petitioner requests the Court to make orders for the terms and conditions of Petitioner's conservatorship and possession of and access to the {{children_noun}}.{{/if}}
{{/if}}
</p>

<p><strong class="art-header">Division of Marital Estate.</strong> Petitioner requests the Court to order a division of the estate of the parties in a manner that the Court deems just and right, as provided by the Texas Family Code.</p>

{{#if name_change}}
<p><strong class="art-header">Request for Change of Name.</strong> Petitioner requests a change of name to {{new_name}}.</p>
{{/if}}

<p><strong class="art-header">Attorney's Fees, Court Costs, Expenses, and Interest.</strong> It was necessary for Petitioner to secure the services of {{attorney_name}}, a licensed attorney, to prepare and prosecute this suit. To effect an equitable division of the estate of the parties and as a part of the division,{{#if has_children}} and for services rendered in connection with conservatorship and support of the {{children_noun}},{{/if}} judgment for reasonable and necessary attorney's fees, court costs, and expenses through trial and appeal should be granted against Respondent and in favor of Petitioner for the use and benefit of Petitioner's attorney and be ordered paid directly to Petitioner's attorney, who may enforce the judgment in the attorney's own name. Petitioner requests postjudgment interest as allowed by law.</p>

<p><strong class="art-header">Prayer.</strong> Petitioner prays that citation and notice issue as required by law and that the Court grant a divorce and all other relief requested in this petition.</p>

<p>Petitioner prays for general relief.</p>

<p style="text-align:right; margin-top:4pt">Respectfully submitted,</p>

<div class="sig-line"></div>
<div class="sig-name">{{attorney_name}}<br>
State Bar No. {{attorney_bar_number}}<br>
{{firm_name}}<br>
{{firm_address}}<br>
{{firm_phone}}<br>
{{firm_email}}<br>
<em>Attorney for Petitioner</em>
</div>

</body>
</html>$TEMPLATE$,

$SCHEMA$[
  {"key":"is_client_petitioner","label":"Client's role in case","type":"select","default":"true","options":[{"value":"true","label":"Petitioner (client filed)"},{"value":"false","label":"Respondent (opposing party filed)"}]},
  {"key":"discovery_level","label":"Discovery level","type":"select","default":"2","options":[{"value":"1","label":"Level 1 â€” Rule 190.2 (no children, estate â‰¤$250K)"},{"value":"2","label":"Level 2 â€” Rule 190.3 (standard)"},{"value":"3","label":"Level 3 â€” Rule 190.4 (complex)"}]},
  {"key":"object_to_associate_judge","label":"Object to associate judge assignment","type":"toggle","default":false},
  {"key":"domicile_scenario","label":"Texas domicile","type":"select","default":"petitioner","options":[{"value":"petitioner","label":"Petitioner (6 months TX + 90 days county)"},{"value":"respondent","label":"Petitioner out of state; Respondent is TX domiciliary"}]},
  {"key":"service_type","label":"Service on Respondent","type":"select","default":"personal","options":[{"value":"personal","label":"Personal service at Respondent's address"},{"value":"none","label":"No service necessary at this time"},{"value":"substituted","label":"Substituted / publication service"}]},
  {"key":"relief_type","label":"Relief sought","type":"select","default":"monetary_nonmonetary_250k","options":[{"value":"monetary_250k","label":"Monetary only â€” $250K or less"},{"value":"monetary_nonmonetary_250k","label":"Monetary + non-monetary â€” $250K or less"},{"value":"monetary_250k_1m","label":"Monetary $250Kâ€“$1M"},{"value":"monetary_over_1m","label":"Monetary over $1M"},{"value":"nonmonetary","label":"Non-monetary only"}]},
  {"key":"grounds","label":"Grounds for divorce","type":"select","default":"insupportability","options":[{"value":"insupportability","label":"Insupportability (no-fault)"},{"value":"cruelty","label":"Cruel treatment"},{"value":"adultery","label":"Adultery"},{"value":"felony","label":"Felony conviction"},{"value":"abandonment","label":"Abandonment (1+ years)"},{"value":"living_apart","label":"Living apart (3+ years)"},{"value":"mental_disorder","label":"Mental disorder (3+ years confinement)"}]},
  {"key":"conservatorship","label":"Conservatorship (if children)","type":"select","default":"jmc_petitioner","options":[{"value":"jmc_petitioner","label":"JMC â€” Petitioner has primary residence"},{"value":"jmc_respondent","label":"JMC â€” Respondent has primary residence"},{"value":"petitioner_sole","label":"Petitioner sole managing conservator"},{"value":"petitioner_possessory","label":"Petitioner possessory conservator"}]},
  {"key":"name_change","label":"Petitioner requests name change","type":"toggle","default":false},
  {"key":"new_name","label":"New name (if requested)","type":"text","condition":"name_change","placeholder":"Full name to restore"},
  {"key":"marriage_date","label":"Date of marriage","type":"date","source":"matter.date_of_marriage","placeholder":"If not on file"},
  {"key":"separation_date","label":"Date of separation","type":"date","source":"matter.separation_date","placeholder":"If not on file"},
  {"key":"court_number","label":"Court number","type":"text","source":"matter.court_number","placeholder":"e.g. 303rd"},
  {"key":"court_county","label":"Court county","type":"text","source":"matter.court_county","placeholder":"e.g. Dallas"}
]$SCHEMA$::jsonb
);


-- ════════════════════════════════════════
-- 1107_more_practice_areas.sql
-- ════════════════════════════════════════
-- Migration 1107: Add Personal Injury and Criminal practice areas

INSERT INTO public.practice_areas (key, name, description, sort_order) VALUES
  ('personal_injury', 'Personal Injury', 'Auto accidents, slip & fall, medical malpractice, wrongful death, and related tort matters', 30),
  ('criminal',        'Criminal',        'DWI/DUI, drug offenses, assault, theft, domestic violence, expunctions, and related criminal defense matters', 40)
ON CONFLICT (key) DO NOTHING;

-- â”€â”€ Seed: Personal Injury â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.case_types (practice_area_id, key, name, sort_order)
SELECT pa.id, ct.key, ct.name, ct.sort_order
FROM public.practice_areas pa
CROSS JOIN (VALUES
  ('auto_accident',        'Auto Accident',              10),
  ('truck_accident',       'Truck Accident',             20),
  ('motorcycle_accident',  'Motorcycle Accident',        30),
  ('slip_and_fall',        'Slip & Fall',                40),
  ('premises_liability',   'Premises Liability',         50),
  ('medical_malpractice',  'Medical Malpractice',        60),
  ('product_liability',    'Product Liability',          70),
  ('wrongful_death',       'Wrongful Death',             80),
  ('workplace_injury',     'Workplace Injury',           90),
  ('dog_bite',             'Dog Bite / Animal Attack',  100),
  ('other',                'Other',                     999)
) AS ct(key, name, sort_order)
WHERE pa.key = 'personal_injury'
ON CONFLICT (practice_area_id, key) DO NOTHING;

-- â”€â”€ Seed: Criminal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.case_types (practice_area_id, key, name, sort_order)
SELECT pa.id, ct.key, ct.name, ct.sort_order
FROM public.practice_areas pa
CROSS JOIN (VALUES
  ('dwi_dui',              'DWI / DUI',                  10),
  ('drug_offense',         'Drug Offense',               20),
  ('assault_battery',      'Assault / Battery',          30),
  ('domestic_violence',    'Domestic Violence',          40),
  ('theft_robbery',        'Theft / Robbery',            50),
  ('sexual_assault',       'Sexual Assault',             60),
  ('murder_homicide',      'Murder / Homicide',          70),
  ('white_collar',         'White Collar Crime',         80),
  ('juvenile',             'Juvenile',                   90),
  ('probation_violation',  'Probation Violation',       100),
  ('expunction',           'Expunction / Non-Disclosure',110),
  ('other',                'Other',                     999)
) AS ct(key, name, sort_order)
WHERE pa.key = 'criminal'
ON CONFLICT (practice_area_id, key) DO NOTHING;

-- â”€â”€ Extension table: Personal Injury â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE IF NOT EXISTS public.client_personal_injury (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id            uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  incident_date        date,
  incident_location    text,
  incident_description text,
  at_fault_party       text,
  insurance_carrier    text,
  claim_number         text,
  policy_limits        numeric(12,2),
  treating_physician   text,
  medical_provider     text,
  sol_date             date,
  demand_amount        numeric(12,2),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_personal_injury ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_personal_injury_select" ON public.client_personal_injury
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "client_personal_injury_insert" ON public.client_personal_injury
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "client_personal_injury_update" ON public.client_personal_injury
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "client_personal_injury_delete" ON public.client_personal_injury
  FOR DELETE TO authenticated USING (true);

-- â”€â”€ Extension table: Criminal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

CREATE TABLE IF NOT EXISTS public.client_criminal (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  matter_id         uuid NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  arrest_date       date,
  offense_date      date,
  cause_number      text,
  charges           text,
  arresting_agency  text,
  bond_amount       numeric(12,2),
  bond_type         text,  -- personal_recognizance | cash | surety | no_bond
  prosecutor        text,
  next_hearing_type text,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_criminal ENABLE ROW LEVEL SECURITY;

CREATE POLICY "client_criminal_select" ON public.client_criminal
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "client_criminal_insert" ON public.client_criminal
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "client_criminal_update" ON public.client_criminal
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "client_criminal_delete" ON public.client_criminal
  FOR DELETE TO authenticated USING (true);


-- ════════════════════════════════════════
-- 1108_enabled_practice_areas_rls.sql
-- ════════════════════════════════════════
-- Migration 1108: Practice area management â€” RLS + settings module registration

-- â”€â”€ Owner-write policy for enabled_practice_areas â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
-- Migration 007 only created a SELECT policy; this adds the management policy
-- mirroring the pattern from 1050_enabled_modules.sql

CREATE POLICY "owners can manage enabled_practice_areas"
  ON public.enabled_practice_areas FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.roles r ON u.role_id = r.id
      WHERE u.auth_id = auth.uid() AND r.name = 'Owner'
    )
  );

-- â”€â”€ Register Practice Areas settings module â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default)
VALUES (
  'practice_areas_settings',
  'Practice Areas',
  'Enable or disable practice areas for this firm.',
  'briefcase',
  'settings/practice-areas',
  1,
  86,
  true
)
ON CONFLICT (key) DO NOTHING;

-- Owner only â€” this is a firm configuration page
INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'practice_areas_settings', 'admin'::public.access_level
FROM public.roles r
WHERE r.name = 'Owner'
ON CONFLICT (role_id, module_key) DO NOTHING;


-- ════════════════════════════════════════
-- 1109_doc_template_library.sql
-- ════════════════════════════════════════
-- Migration 1109: Document Template Library
-- Introduces a curated, IurisIQ-maintained library of suggested document templates.
-- Firms start with an empty document_checklists and import from this library.
-- is_recommended = true â†’ included in one-click "Add Recommended Templates" import.
-- practice_area_key NULL = universal (applicable to all enabled PAs).
-- case_type_keys    NULL = all case types within the practice area.

-- â”€â”€ Library table â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

-- â”€â”€ Track library origin on adopted templates â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

ALTER TABLE public.document_checklists
  ADD COLUMN IF NOT EXISTS library_id uuid
    REFERENCES public.doc_template_library(id) ON DELETE SET NULL;

-- â”€â”€ Seed: Universal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.doc_template_library
  (doc_name, practice_area_key, case_type_keys, doc_category, is_required_by_default, is_recommended, sort_order)
VALUES
  ('Photo ID (Driver''s License or Passport)', NULL, NULL, 'id',   true,  true,  10),
  ('Social Security Card',                     NULL, NULL, 'id',   false, true,  20);

-- â”€â”€ Seed: Immigration â€” all case types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

-- â”€â”€ Seed: Immigration â€” Family-Based Petition â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.doc_template_library
  (doc_name, practice_area_key, case_type_keys, doc_category, is_required_by_default, is_recommended, sort_order)
VALUES
  ('Petitioner''s Proof of U.S. Citizenship or LPR Status',   'immigration', ARRAY['family_based_petition'], 'id',       true,  true,  10),
  ('Marriage Certificate (with certified translation)',         'immigration', ARRAY['family_based_petition'], 'id',       true,  true,  20),
  ('Proof of Termination of Prior Marriages (if applicable)',  'immigration', ARRAY['family_based_petition'], 'other',    false, false, 30),
  ('Joint Sponsor Documents (I-864A, if applicable)',          'immigration', ARRAY['family_based_petition'], 'financial', false, false, 40);

-- â”€â”€ Seed: Immigration â€” Adjustment of Status â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.doc_template_library
  (doc_name, practice_area_key, case_type_keys, doc_category, is_required_by_default, is_recommended, sort_order)
VALUES
  ('Medical Examination (Form I-693, sealed envelope)',        'immigration', ARRAY['adjustment_of_status'], 'other',  true,  true,  10),
  ('Evidence of Lawful Entry into the U.S.',                   'immigration', ARRAY['adjustment_of_status'], 'id',     true,  true,  20),
  ('Proof of Continuous Physical Presence',                    'immigration', ARRAY['adjustment_of_status'], 'other',  false, false, 30);

-- â”€â”€ Seed: Immigration â€” DACA â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.doc_template_library
  (doc_name, practice_area_key, case_type_keys, doc_category, is_required_by_default, is_recommended, sort_order)
VALUES
  ('Proof of Entry Before Age 16',                             'immigration', ARRAY['daca'], 'id',    true, true,  10),
  ('Proof of Continuous Residence since June 15, 2007',        'immigration', ARRAY['daca'], 'id',    true, true,  20),
  ('School Records, Diplomas, or Transcripts',                 'immigration', ARRAY['daca'], 'other', true, true,  30),
  ('Prior DACA Approval Notice (if renewal)',                  'immigration', ARRAY['daca'], 'other', false,false, 40);

-- â”€â”€ Seed: Immigration â€” Asylum â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.doc_template_library
  (doc_name, practice_area_key, case_type_keys, doc_category, is_required_by_default, is_recommended, sort_order)
VALUES
  ('Personal Declaration of Fear / Asylum Statement',          'immigration', ARRAY['asylum'], 'other', true, true,  10),
  ('Country Condition Evidence (news, reports, DOJ records)',  'immigration', ARRAY['asylum'], 'other', true, true,  20),
  ('Evidence of Past Persecution (photos, police reports)',    'immigration', ARRAY['asylum'], 'other', false,false, 30);

-- â”€â”€ Seed: Criminal â€” all case types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

-- â”€â”€ Seed: Personal Injury â€” all case types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

-- â”€â”€ Seed: Personal Injury â€” Auto / Truck / Motorcycle â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.doc_template_library
  (doc_name, practice_area_key, case_type_keys, doc_category, is_required_by_default, is_recommended, sort_order)
VALUES
  ('Client''s Auto Insurance Declarations Page',               'personal_injury', ARRAY['auto_accident','truck_accident','motorcycle_accident'], 'financial', true,  true,  10),
  ('Other Driver''s Insurance Information',                    'personal_injury', ARRAY['auto_accident','truck_accident','motorcycle_accident'], 'financial', true,  true,  20),
  ('Vehicle Photos / Damage Estimate',                         'personal_injury', ARRAY['auto_accident','truck_accident','motorcycle_accident'], 'other',    false, true,  30),
  ('Tow / Rental / Repair Receipts',                           'personal_injury', ARRAY['auto_accident','truck_accident','motorcycle_accident'], 'financial', false, false, 40);

-- â”€â”€ Seed: Family Law â€” all case types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

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

-- â”€â”€ Seed: Family Law â€” Divorce â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

INSERT INTO public.doc_template_library
  (doc_name, practice_area_key, case_type_keys, doc_category, is_required_by_default, is_recommended, sort_order)
VALUES
  ('Marriage Certificate',                                     'family_law', ARRAY['divorce'], 'id',              true,  true,  10),
  ('Petition for Divorce',                                     'family_law', ARRAY['divorce'], 'pleading',        true,  true,  20),
  ('Decree of Divorce (draft/final)',                          'family_law', ARRAY['divorce'], 'agreement',       true,  true,  30),
  ('QDRO (if applicable)',                                     'family_law', ARRAY['divorce'], 'court_order',     false, false, 40),
  ('Closing letter',                                           'family_law', ARRAY['divorce'], 'correspondence',  true,  false, 50);

-- ────────────────────────────────────────────────────────────────────────────
-- Migration 1110: Immigration module
-- ────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.client_immigration
  DROP COLUMN IF EXISTS visa_category,
  DROP COLUMN IF EXISTS priority_date,
  DROP COLUMN IF EXISTS receipt_number,
  DROP COLUMN IF EXISTS petitioner_name,
  DROP COLUMN IF EXISTS beneficiary_name,
  DROP COLUMN IF EXISTS nationality,
  DROP COLUMN IF EXISTS authorized_stay_until;

ALTER TABLE public.client_immigration
  RENAME COLUMN last_entry_date TO last_entry_date_tmp;

ALTER TABLE public.client_immigration
  ADD COLUMN IF NOT EXISTS last_entry_date date;

UPDATE public.client_immigration
  SET last_entry_date = last_entry_date_tmp
  WHERE last_entry_date_tmp IS NOT NULL;

ALTER TABLE public.client_immigration
  DROP COLUMN IF EXISTS last_entry_date_tmp;

ALTER TABLE public.client_immigration
  ADD COLUMN IF NOT EXISTS country_of_citizenship    text,
  ADD COLUMN IF NOT EXISTS languages                 text,
  ADD COLUMN IF NOT EXISTS immigration_status        text,
  ADD COLUMN IF NOT EXISTS port_of_entry             text,
  ADD COLUMN IF NOT EXISTS i94_number                text,
  ADD COLUMN IF NOT EXISTS i94_expiry                date,
  ADD COLUMN IF NOT EXISTS is_detained               boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS detention_facility        text,
  ADD COLUMN IF NOT EXISTS has_prior_removal_order   boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS prior_removal_order_notes text,
  ADD COLUMN IF NOT EXISTS has_criminal_history      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS criminal_history_notes    text,
  ADD COLUMN IF NOT EXISTS case_data                 jsonb NOT NULL DEFAULT '{}';

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'client_immigration_matter_id_unique'
  ) THEN
    ALTER TABLE public.client_immigration
      ADD CONSTRAINT client_immigration_matter_id_unique UNIQUE (matter_id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.client_immigration_family_members (
  id                        uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  immigration_id            uuid        NOT NULL REFERENCES public.client_immigration(id) ON DELETE CASCADE,
  matter_id                 uuid        NOT NULL REFERENCES public.matters(id) ON DELETE CASCADE,
  first_name                text        NOT NULL,
  last_name                 text,
  relationship              text        NOT NULL,
  dob                       date,
  country_of_birth          text,
  nationality               text,
  a_number                  text,
  immigration_status        text,
  is_derivative_beneficiary boolean     NOT NULL DEFAULT false,
  notes                     text,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.client_immigration_family_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "imm_family_members_select" ON public.client_immigration_family_members
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "imm_family_members_insert" ON public.client_immigration_family_members
  FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "imm_family_members_update" ON public.client_immigration_family_members
  FOR UPDATE TO authenticated USING (true);
CREATE POLICY "imm_family_members_delete" ON public.client_immigration_family_members
  FOR DELETE TO authenticated USING (true);

CREATE TABLE IF NOT EXISTS public.enabled_immigration_case_types (
  sub_tab_key text        PRIMARY KEY,
  enabled_at  timestamptz NOT NULL DEFAULT now(),
  enabled_by  uuid        REFERENCES public.users(id)
);

ALTER TABLE public.enabled_immigration_case_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "imm_case_types_select" ON public.enabled_immigration_case_types
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "imm_case_types_manage" ON public.enabled_immigration_case_types
  FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.users u
      JOIN public.roles r ON u.role_id = r.id
      WHERE u.auth_id = auth.uid()
        AND r.name IN ('Owner', 'Partner Attorney')
    )
  );

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT r.id, 'practice_areas_settings', 'read'::public.access_level
FROM public.roles r
WHERE r.name = 'Partner Attorney'
ON CONFLICT (role_id, module_key) DO NOTHING;
