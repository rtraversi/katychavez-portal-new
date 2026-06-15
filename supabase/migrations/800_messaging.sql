-- Migration 800: Messaging module (v1 — portal channel + email notifications)
-- Two tables: conversations (one per client) + messages (channel-aware).
-- Twilio channels (sms, whatsapp, email) are schema-ready but not wired yet.
-- Apply AFTER migrations 001–006 and 500–502.

-- ── CONVERSATIONS ─────────────────────────────────────────────────────────────

CREATE TABLE public.conversations (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id       UUID        NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_message_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id)  -- one conversation thread per client
);

CREATE INDEX idx_conversations_client_id   ON public.conversations(client_id);
CREATE INDEX idx_conversations_last_msg    ON public.conversations(last_message_at DESC);

-- ── MESSAGES ──────────────────────────────────────────────────────────────────

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

-- ── RLS ───────────────────────────────────────────────────────────────────────

ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.messages      ENABLE ROW LEVEL SECURITY;

-- Staff: full access via module permissions
CREATE POLICY "convos_staff_select" ON public.conversations
  FOR SELECT USING (public.can_read('messaging'));

CREATE POLICY "convos_staff_insert" ON public.conversations
  FOR INSERT WITH CHECK (public.can_write('messaging'));

CREATE POLICY "convos_staff_update" ON public.conversations
  FOR UPDATE USING (public.can_write('messaging'));

-- Clients: only their own conversation (additive — ORed with staff policy)
CREATE POLICY "convos_client_select" ON public.conversations
  FOR SELECT USING (client_id = public.my_client_id());

-- Messages — staff
CREATE POLICY "msgs_staff_select" ON public.messages
  FOR SELECT USING (public.can_read('messaging'));

CREATE POLICY "msgs_staff_insert" ON public.messages
  FOR INSERT WITH CHECK (public.can_write('messaging'));

CREATE POLICY "msgs_staff_update" ON public.messages
  FOR UPDATE USING (public.can_write('messaging'));

-- Messages — client sees only their own conversation's messages
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

-- ── MODULE REGISTRATION ───────────────────────────────────────────────────────

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

-- ── ROLE ACCESS ───────────────────────────────────────────────────────────────
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
