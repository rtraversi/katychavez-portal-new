-- Migration 002: RBAC — roles · users (profiles) · modules · role_module_access
-- Also: FK back-fills, auth trigger, default roles/modules seed data.
-- Apply AFTER migration 001.

-- ──────────────────────────────────────────────────────────────────────────────
-- ENUMS
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TYPE public.access_level AS ENUM ('none', 'read', 'write', 'admin');

-- ──────────────────────────────────────────────────────────────────────────────
-- ROLES
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.roles (
  id              uuid  PRIMARY KEY DEFAULT gen_random_uuid(),
  name            text  NOT NULL UNIQUE,
  description     text,
  is_system_role  boolean NOT NULL DEFAULT false,  -- system roles cannot be deleted
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- ──────────────────────────────────────────────────────────────────────────────
-- USERS  (profile table — shadows auth.users)
-- One row per auth.users row; created by trigger on auth signup.
-- ──────────────────────────────────────────────────────────────────────────────

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

-- ──────────────────────────────────────────────────────────────────────────────
-- MODULES  (registry — the extension contract)
-- Modules self-register here. Adding a module = INSERT + append to registry.js.
-- Migration number ranges: core 001-099, billing 100-199, ai_brain 200-299,
--   messaging 300-399, uploads 400-499, esign 500-599, draft_forms 600-699,
--   dashboard 700-799, word_embed 800-899, (future 900-999).
-- ──────────────────────────────────────────────────────────────────────────────

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

-- ──────────────────────────────────────────────────────────────────────────────
-- ROLE_MODULE_ACCESS  (the permission matrix)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE TABLE public.role_module_access (
  role_id       uuid  NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  module_key    text  NOT NULL REFERENCES public.modules(key) ON DELETE CASCADE,
  access_level  public.access_level NOT NULL DEFAULT 'none',
  PRIMARY KEY (role_id, module_key)
);

CREATE INDEX idx_rma_role   ON public.role_module_access (role_id);
CREATE INDEX idx_rma_module ON public.role_module_access (module_key);

-- ──────────────────────────────────────────────────────────────────────────────
-- AUTH TRIGGER  — creates profile on Supabase auth signup
-- Default role: Paralegal (lowest privilege). Owner promotes via permissions UI.
-- ──────────────────────────────────────────────────────────────────────────────

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

-- ──────────────────────────────────────────────────────────────────────────────
-- SEED: DEFAULT ROLES
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO public.roles (name, description, is_system_role) VALUES
  ('Owner',      'Full access to all modules and settings. Cannot be deleted.', true),
  ('Attorney',   'Client and matter management, tasks, uploads.',               false),
  ('Paralegal',  'Client intake, document tracking, tasks.',                    false),
  ('Staff Admin','User management and permissions.',                             false);

-- ──────────────────────────────────────────────────────────────────────────────
-- SEED: MODULE REGISTRY
-- ──────────────────────────────────────────────────────────────────────────────

INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default) VALUES
  ('core',         'Clients & Matters', 'Client cards, matter management, and client card.',  'users',         'clients',     0,  10, true),
  ('tasks',        'Tasks',             'Task list and smart reminder engine.',                'check-square',  'tasks',       0,  20, true),
  ('uploads',      'Document Uploads',  'Client document uploads and missing-doc tracking.',  'upload',        'uploads',     1,  30, false),
  ('messaging',    'Messaging',         'Two-way portal messaging — replaces email inbox.',   'message-square','messaging',   1,  40, false),
  ('billing',      'Billing & Time',    'Time tracking and invoicing.',                       'dollar-sign',   'billing',     1,  50, false),
  ('ai_brain',     'AI Assistant',      'RAG query box trained on your firm''s knowledge.',  'cpu',           'ai-brain',    1,  60, false),
  ('draft_forms',  'Document Drafting', 'Generate forms from your Dropbox templates.',        'file-text',     'draft-forms', 1,  70, false),
  ('esign',        'E-Signatures',      'In-portal e-sign with SHA-256 audit trail (UETA).',  'pen-tool',      'esign',       1,  80, false),
  ('dashboard',    'Analytics',         'Dashboard aggregating data across all modules.',     'bar-chart-2',   'dashboard',   2,  90, false),
  ('word_embed',   'Word Integration',  'Open and save Word documents without leaving portal.','file',         'word-embed',  2, 100, false);

-- ──────────────────────────────────────────────────────────────────────────────
-- SEED: ROLE_MODULE_ACCESS  (default permission matrix)
-- ──────────────────────────────────────────────────────────────────────────────

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
