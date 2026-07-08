-- Migration 1400: activity_log table + DB triggers
-- Feeds the "Recent Activity" home sidebar widget.
-- Events: document_uploaded, message_received, task_completed,
--         matter_opened, matter_status_changed, trust_deposit
-- Applied: sandbox ☐  dev ☐  prod ☐

-- ── TABLE ─────────────────────────────────────────────────────────────────────

CREATE TABLE public.activity_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at  timestamptz NOT NULL DEFAULT now(),
  event_type  text NOT NULL,
  actor_id    uuid REFERENCES public.users(id) ON DELETE SET NULL,
  actor_name  text,
  matter_id   uuid REFERENCES public.matters(id) ON DELETE CASCADE,
  client_id   uuid REFERENCES public.clients(id) ON DELETE CASCADE,
  title       text NOT NULL,
  client_name text,
  matter_name text,
  link_route  text
);

CREATE INDEX idx_activity_log_created ON public.activity_log (created_at DESC);
CREATE INDEX idx_activity_log_matter  ON public.activity_log (matter_id, created_at DESC);

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- Staff read: Owner sees all; others see rows where matter_id is NULL (firm-wide)
-- or matter_id is on a matter assigned to them.
-- Client role excluded entirely (no 'core' module read → policy returns false).
CREATE POLICY "activity_log_read" ON public.activity_log
  FOR SELECT USING (
    public.can_read('core')
    AND (
      -- Owner: unrestricted
      EXISTS (
        SELECT 1 FROM public.users u
        JOIN  public.roles r ON r.id = u.role_id
        WHERE u.auth_id = auth.uid()
          AND r.name = 'Owner'
      )
      OR
      -- Others: firm-wide events (no matter) or matters assigned to them
      matter_id IS NULL
      OR matter_id IN (
        SELECT id FROM public.matters
        WHERE assigned_attorney_id = public.my_user_id()
      )
    )
  );

-- Inserts only via SECURITY DEFINER trigger functions (they bypass RLS).
-- Deny direct inserts from application layer.
CREATE POLICY "activity_log_no_direct_insert" ON public.activity_log
  FOR INSERT WITH CHECK (false);

-- ── HELPERS ───────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.activity_user_name(p_user_id uuid)
RETURNS text LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT first_name || ' ' || last_name FROM public.users WHERE id = p_user_id;
$$;

-- ── TRIGGER: document_uploaded ─────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_activity_document_uploaded()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client_id   uuid;
  v_client_name text;
  v_matter_name text;
BEGIN
  SELECT m.client_id,
         c.first_name || ' ' || c.last_name,
         initcap(replace(m.case_type::text, '_', ' '))
  INTO   v_client_id, v_client_name, v_matter_name
  FROM   public.matters m
  JOIN   public.clients c ON c.id = m.client_id
  WHERE  m.id = NEW.matter_id;

  INSERT INTO public.activity_log
    (event_type, actor_id, actor_name, matter_id, client_id, title, client_name, matter_name, link_route)
  VALUES (
    'document_uploaded',
    NEW.uploaded_by,
    public.activity_user_name(NEW.uploaded_by),
    NEW.matter_id,
    v_client_id,
    'Document uploaded: ' || NEW.name,
    v_client_name,
    v_matter_name,
    'uploads?matter=' || NEW.matter_id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER activity_document_uploaded
  AFTER INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.trg_activity_document_uploaded();

-- ── TRIGGER: message_received ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_activity_message_received()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client_id   uuid;
  v_client_name text;
BEGIN
  IF NEW.direction != 'inbound' THEN RETURN NEW; END IF;

  SELECT cv.client_id,
         c.first_name || ' ' || c.last_name
  INTO   v_client_id, v_client_name
  FROM   public.conversations cv
  JOIN   public.clients c ON c.id = cv.client_id
  WHERE  cv.id = NEW.conversation_id;

  INSERT INTO public.activity_log
    (event_type, matter_id, client_id, title, client_name, link_route)
  VALUES (
    'message_received',
    NULL,
    v_client_id,
    'Message received from ' || coalesce(v_client_name, 'client'),
    v_client_name,
    'messages'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER activity_message_received
  AFTER INSERT ON public.messages
  FOR EACH ROW EXECUTE FUNCTION public.trg_activity_message_received();

-- ── TRIGGER: task_completed ────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_activity_task_completed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client_id   uuid;
  v_client_name text;
  v_matter_name text;
BEGIN
  IF NEW.status != 'completed' OR OLD.status = 'completed' THEN RETURN NEW; END IF;

  IF NEW.matter_id IS NOT NULL THEN
    SELECT m.client_id,
           c.first_name || ' ' || c.last_name,
           initcap(replace(m.case_type::text, '_', ' '))
    INTO   v_client_id, v_client_name, v_matter_name
    FROM   public.matters m
    JOIN   public.clients c ON c.id = m.client_id
    WHERE  m.id = NEW.matter_id;
  END IF;

  INSERT INTO public.activity_log
    (event_type, actor_id, actor_name, matter_id, client_id, title, client_name, matter_name, link_route)
  VALUES (
    'task_completed',
    NEW.assigned_to,
    public.activity_user_name(NEW.assigned_to),
    NEW.matter_id,
    v_client_id,
    'Task completed: ' || NEW.title,
    v_client_name,
    v_matter_name,
    CASE WHEN NEW.matter_id IS NOT NULL THEN 'tasks?matter=' || NEW.matter_id ELSE 'tasks' END
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER activity_task_completed
  AFTER UPDATE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION public.trg_activity_task_completed();

-- ── TRIGGER: matter_opened ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_activity_matter_opened()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client_name text;
  v_matter_name text;
BEGIN
  SELECT c.first_name || ' ' || c.last_name
  INTO   v_client_name
  FROM   public.clients c WHERE c.id = NEW.client_id;

  v_matter_name := initcap(replace(NEW.case_type::text, '_', ' '));

  INSERT INTO public.activity_log
    (event_type, matter_id, client_id, title, client_name, matter_name, link_route)
  VALUES (
    'matter_opened',
    NEW.id,
    NEW.client_id,
    'Matter opened: ' || v_matter_name || ' — ' || coalesce(v_client_name, 'client'),
    v_client_name,
    v_matter_name,
    'clients?client=' || NEW.client_id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER activity_matter_opened
  AFTER INSERT ON public.matters
  FOR EACH ROW EXECUTE FUNCTION public.trg_activity_matter_opened();

-- ── TRIGGER: matter_status_changed ────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_activity_matter_status_changed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client_name text;
  v_matter_name text;
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;

  SELECT c.first_name || ' ' || c.last_name
  INTO   v_client_name
  FROM   public.clients c WHERE c.id = NEW.client_id;

  v_matter_name := initcap(replace(NEW.case_type::text, '_', ' '));

  INSERT INTO public.activity_log
    (event_type, matter_id, client_id, title, client_name, matter_name, link_route)
  VALUES (
    'matter_status_changed',
    NEW.id,
    NEW.client_id,
    'Matter ' || initcap(NEW.status::text) || ': ' || v_matter_name || ' — ' || coalesce(v_client_name, 'client'),
    v_client_name,
    v_matter_name,
    'clients?client=' || NEW.client_id
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER activity_matter_status_changed
  AFTER UPDATE ON public.matters
  FOR EACH ROW EXECUTE FUNCTION public.trg_activity_matter_status_changed();

-- ── TRIGGER: trust_deposit ─────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.trg_activity_trust_deposit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_client_id   uuid;
  v_client_name text;
  v_matter_name text;
BEGIN
  IF NEW.entry_type != 'deposit' THEN RETURN NEW; END IF;

  SELECT m.client_id,
         c.first_name || ' ' || c.last_name,
         initcap(replace(m.case_type::text, '_', ' '))
  INTO   v_client_id, v_client_name, v_matter_name
  FROM   public.matters m
  JOIN   public.clients c ON c.id = m.client_id
  WHERE  m.id = NEW.matter_id;

  INSERT INTO public.activity_log
    (event_type, actor_id, actor_name, matter_id, client_id, title, client_name, matter_name, link_route)
  VALUES (
    'trust_deposit',
    NEW.created_by,
    public.activity_user_name(NEW.created_by),
    NEW.matter_id,
    v_client_id,
    'Trust deposit: $' || to_char(NEW.amount, 'FM999,999.00') || ' — ' || coalesce(v_client_name, 'client'),
    v_client_name,
    v_matter_name,
    'trust'
  );
  RETURN NEW;
END;
$$;

CREATE TRIGGER activity_trust_deposit
  AFTER INSERT ON public.trust_ledger_entries
  FOR EACH ROW EXECUTE FUNCTION public.trg_activity_trust_deposit();
