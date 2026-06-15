-- Migration 003: Row Level Security policies
-- Apply AFTER migrations 001 + 002.
-- Principle: DB-level enforcement, not UI-only. Hiding menu items is UX, not security.
-- v1: module on/off access. Record-level (DV, assigned-matter scoping) PINNED — see §16 architecture.md.

-- ──────────────────────────────────────────────────────────────────────────────
-- HELPER FUNCTIONS
-- ──────────────────────────────────────────────────────────────────────────────

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

-- ──────────────────────────────────────────────────────────────────────────────
-- ENABLE RLS ON ALL TABLES
-- ──────────────────────────────────────────────────────────────────────────────

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

-- ──────────────────────────────────────────────────────────────────────────────
-- ROLES TABLE
-- ──────────────────────────────────────────────────────────────────────────────

CREATE POLICY "roles_read"   ON public.roles FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "roles_manage" ON public.roles FOR ALL    USING (public.can_admin('core'));

-- ──────────────────────────────────────────────────────────────────────────────
-- USERS TABLE
-- ──────────────────────────────────────────────────────────────────────────────

-- Any authenticated active user can see the user list (needed for assignment dropdowns)
CREATE POLICY "users_read"    ON public.users FOR SELECT USING (public.my_user_id() IS NOT NULL);
-- Users can update their own profile (name, phone); admins can update anyone
CREATE POLICY "users_update"  ON public.users FOR UPDATE USING (
  auth_id = auth.uid() OR public.can_admin('core')
);
-- Only admins can create/delete users (invites go through Supabase Auth; this covers edge cases)
CREATE POLICY "users_manage"  ON public.users FOR ALL    USING (public.can_admin('core'));

-- ──────────────────────────────────────────────────────────────────────────────
-- MODULES TABLE  (config read-only for non-admins)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE POLICY "modules_read"   ON public.modules FOR SELECT USING (auth.uid() IS NOT NULL);
CREATE POLICY "modules_manage" ON public.modules FOR ALL    USING (public.can_admin('core'));

-- ──────────────────────────────────────────────────────────────────────────────
-- ROLE_MODULE_ACCESS
-- ──────────────────────────────────────────────────────────────────────────────

CREATE POLICY "rma_read"   ON public.role_module_access FOR SELECT USING (public.my_user_id() IS NOT NULL);
CREATE POLICY "rma_manage" ON public.role_module_access FOR ALL    USING (public.can_admin('core'));

-- ──────────────────────────────────────────────────────────────────────────────
-- CLIENTS
-- DV-confidential filter: PINNED for full implementation — v1 only Owner/admin can see DV records.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE POLICY "clients_select" ON public.clients FOR SELECT USING (
  public.can_read('core')
  AND (NOT is_dv_confidential OR public.can_admin('core'))  -- DV gate (PINNED — tighten in v1 build)
);
CREATE POLICY "clients_insert" ON public.clients FOR INSERT WITH CHECK (public.can_write('core'));
CREATE POLICY "clients_update" ON public.clients FOR UPDATE USING (
  public.can_write('core')
  AND (NOT is_dv_confidential OR public.can_admin('core'))
);
CREATE POLICY "clients_delete" ON public.clients FOR DELETE USING (public.can_admin('core'));

-- ──────────────────────────────────────────────────────────────────────────────
-- MATTERS
-- ──────────────────────────────────────────────────────────────────────────────

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

-- ──────────────────────────────────────────────────────────────────────────────
-- CHILD TABLES  (opposing_parties, children, key_dates, financial_info)
-- Access follows the parent matter's rules. Simplified here — full RLS inherits matter access.
-- ──────────────────────────────────────────────────────────────────────────────

CREATE POLICY "opposing_read"   ON public.opposing_parties FOR SELECT USING (public.can_read('core'));
CREATE POLICY "opposing_write"  ON public.opposing_parties FOR ALL    USING (public.can_write('core'));

CREATE POLICY "children_read"   ON public.children FOR SELECT USING (public.can_read('core'));
CREATE POLICY "children_write"  ON public.children FOR ALL    USING (public.can_write('core'));

CREATE POLICY "keydates_read"   ON public.key_dates FOR SELECT USING (public.can_read('core'));
CREATE POLICY "keydates_write"  ON public.key_dates FOR ALL    USING (public.can_write('core'));

CREATE POLICY "financial_read"  ON public.financial_info FOR SELECT USING (public.can_read('core'));
CREATE POLICY "financial_write" ON public.financial_info FOR ALL    USING (public.can_write('core'));

-- ──────────────────────────────────────────────────────────────────────────────
-- DOCUMENTS  (core module can see; uploads module manages them)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE POLICY "docs_select" ON public.documents FOR SELECT USING (public.can_read('core'));
CREATE POLICY "docs_insert" ON public.documents FOR INSERT WITH CHECK (
  public.can_write('uploads') OR public.can_write('core')
);
CREATE POLICY "docs_update" ON public.documents FOR UPDATE USING (
  public.can_write('uploads') OR public.can_write('core')
);
CREATE POLICY "docs_delete" ON public.documents FOR DELETE USING (public.can_admin('core'));

-- ──────────────────────────────────────────────────────────────────────────────
-- TASKS
-- ──────────────────────────────────────────────────────────────────────────────

CREATE POLICY "tasks_select" ON public.tasks FOR SELECT USING (public.can_read('tasks'));
CREATE POLICY "tasks_insert" ON public.tasks FOR INSERT WITH CHECK (public.can_write('tasks'));
CREATE POLICY "tasks_update" ON public.tasks FOR UPDATE USING (
  public.can_write('tasks')
  OR assigned_to = public.my_user_id()  -- assignees can update their own tasks
);
CREATE POLICY "tasks_delete" ON public.tasks FOR DELETE USING (public.can_admin('tasks'));

-- ──────────────────────────────────────────────────────────────────────────────
-- TASK REMINDER RULES  (config — admin only to edit)
-- ──────────────────────────────────────────────────────────────────────────────

CREATE POLICY "reminder_rules_read"   ON public.task_reminder_rules FOR SELECT USING (public.can_read('tasks'));
CREATE POLICY "reminder_rules_manage" ON public.task_reminder_rules FOR ALL    USING (public.can_admin('core'));
