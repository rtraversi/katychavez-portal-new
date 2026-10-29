-- 2200_ai_chat.sql
-- Ask Claude: a private research chat for staff, on Anthropic's commercial API.
-- Range 2200-2299 = AI Chat. KCL-only module (not part of the template).
--
-- Why it exists: staff can't put client details into a consumer AI plan. This
-- runs every question through the firm's own API key (Commercial Terms: no
-- training on inputs, short retention), from the Worker, so a question like
-- "entered in '94, attempted entry in '96 and '99, filing a 212 waiver: what
-- evidence?" can carry the real facts.
--
--   ai_chat_conversations  one row per chat, owned by the staff user who started it
--   ai_chat_messages       every turn, with the API content blocks kept verbatim
--                          (thinking signatures, web search results) so a chat
--                          can be resumed weeks later and replayed exactly
--   ai_chat_attachments    PDFs and images attached to a question. The file lives
--                          in R2 (ai-chat/...); this row is the pointer.
--
-- Access: all staff roles get write, Owner gets admin (admin also sees the
-- usage and storage panel). Chats are private to the person who wrote them:
-- RLS shows a user only their own. Every write goes through the Worker with the
-- service role, so authenticated gets SELECT only.
--
-- Retention: kept forever for now (Rob, 2026-10-27). The admin panel shows the
-- table sizes and attachment bytes so growth can be watched.

-- ── Module registration ─────────────────────────────────────────────────────
INSERT INTO public.modules (key, name, description, icon, route, wave, sort_order, enabled_by_default, tier)
VALUES (
  'ai_chat',
  'Ask Claude',
  'Private research chat for client questions, on the firm''s commercial Claude API.',
  'cpu',
  'ai-chat',
  2,
  15,
  false,
  'premium'
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO public.role_module_access (role_id, module_key, access_level)
SELECT id, 'ai_chat',
       CASE WHEN name = 'Owner' THEN 'admin' ELSE 'write' END::public.access_level
FROM public.roles
WHERE name <> 'Client'
ON CONFLICT (role_id, module_key) DO NOTHING;

INSERT INTO public.enabled_modules (module_key)
VALUES ('ai_chat')
ON CONFLICT DO NOTHING;

-- ── Conversations ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.ai_chat_conversations (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title          text        NOT NULL DEFAULT 'New chat' CHECK (char_length(title) BETWEEN 1 AND 200),
  message_count  integer     NOT NULL DEFAULT 0 CHECK (message_count >= 0),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_conversations_user
  ON public.ai_chat_conversations (user_id, updated_at DESC);

-- ── Messages ────────────────────────────────────────────────────────────────
-- content is the Messages API content array. A user turn's files are stored as
-- {"type":"attachment","attachment_id":...} and expanded from R2 at send time,
-- so no file bytes ever land in the database.
CREATE TABLE IF NOT EXISTS public.ai_chat_messages (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid        NOT NULL REFERENCES public.ai_chat_conversations(id) ON DELETE CASCADE,
  role             text        NOT NULL CHECK (role IN ('user', 'assistant')),
  content          jsonb       NOT NULL CHECK (jsonb_typeof(content) = 'array'),
  model            text,                       -- the model that answered (assistant only)
  stop_reason      text,
  usage            jsonb,                      -- summed token counts across the turn's API calls
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_conversation
  ON public.ai_chat_messages (conversation_id, created_at);
CREATE INDEX IF NOT EXISTS idx_ai_chat_messages_created
  ON public.ai_chat_messages (created_at);

-- ── Attachments ─────────────────────────────────────────────────────────────
-- conversation_id is NULL between upload and send. The daily cron deletes
-- attachments that were never sent (and their R2 objects) after a day.
CREATE TABLE IF NOT EXISTS public.ai_chat_attachments (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  conversation_id  uuid        REFERENCES public.ai_chat_conversations(id) ON DELETE CASCADE,
  r2_key           text        NOT NULL UNIQUE,
  file_name        text        NOT NULL,
  content_type     text        NOT NULL,
  size_bytes       integer     NOT NULL CHECK (size_bytes > 0),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ai_chat_attachments_conversation
  ON public.ai_chat_attachments (conversation_id);
CREATE INDEX IF NOT EXISTS idx_ai_chat_attachments_unsent
  ON public.ai_chat_attachments (created_at) WHERE conversation_id IS NULL;

-- ── RLS: your own chats only ────────────────────────────────────────────────
ALTER TABLE public.ai_chat_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chat_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_chat_attachments   ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_chat_conversations_own" ON public.ai_chat_conversations;
CREATE POLICY "ai_chat_conversations_own" ON public.ai_chat_conversations
  FOR SELECT USING (public.can_read('ai_chat') AND user_id = public.my_user_id());

DROP POLICY IF EXISTS "ai_chat_messages_own" ON public.ai_chat_messages;
CREATE POLICY "ai_chat_messages_own" ON public.ai_chat_messages
  FOR SELECT USING (
    public.can_read('ai_chat') AND EXISTS (
      SELECT 1 FROM public.ai_chat_conversations c
      WHERE c.id = conversation_id AND c.user_id = public.my_user_id()
    )
  );

DROP POLICY IF EXISTS "ai_chat_attachments_own" ON public.ai_chat_attachments;
CREATE POLICY "ai_chat_attachments_own" ON public.ai_chat_attachments
  FOR SELECT USING (public.can_read('ai_chat') AND user_id = public.my_user_id());

-- ── Usage and storage, for the admin panel ──────────────────────────────────
-- Service role only: the Worker checks the caller is an ai_chat admin first.
-- Token sums are per model so the page can price them; it labels the result
-- an estimate (fallback turns and cache pricing make it approximate).
CREATE OR REPLACE FUNCTION public.ai_chat_storage_stats()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'conversations',     (SELECT count(*) FROM public.ai_chat_conversations),
    'messages',          (SELECT count(*) FROM public.ai_chat_messages),
    'attachments',       (SELECT count(*) FROM public.ai_chat_attachments),
    'attachment_bytes',  (SELECT coalesce(sum(size_bytes), 0) FROM public.ai_chat_attachments),
    'table_bytes',       pg_total_relation_size('public.ai_chat_conversations')
                       + pg_total_relation_size('public.ai_chat_messages')
                       + pg_total_relation_size('public.ai_chat_attachments'),
    'database_bytes',    pg_database_size(current_database()),
    'users',             (SELECT count(DISTINCT user_id) FROM public.ai_chat_conversations),
    'usage',             coalesce((
      SELECT jsonb_agg(u ORDER BY u.month DESC, u.model)
      FROM (
        SELECT to_char(date_trunc('month', created_at), 'YYYY-MM')                       AS month,
               model,
               count(*)                                                                   AS replies,
               sum(coalesce((usage->>'input_tokens')::bigint, 0))                         AS input_tokens,
               sum(coalesce((usage->>'output_tokens')::bigint, 0))                        AS output_tokens,
               sum(coalesce((usage->>'cache_creation_input_tokens')::bigint, 0))          AS cache_write_tokens,
               sum(coalesce((usage->>'cache_read_input_tokens')::bigint, 0))              AS cache_read_tokens,
               sum(coalesce((usage->>'web_search_requests')::bigint, 0))                  AS web_searches
        FROM public.ai_chat_messages
        WHERE role = 'assistant' AND created_at >= date_trunc('month', now()) - interval '11 months'
        GROUP BY 1, 2
      ) u
    ), '[]'::jsonb)
  );
$$;

REVOKE ALL ON FUNCTION public.ai_chat_storage_stats() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_chat_storage_stats() TO service_role;

-- ── Data API grants (explicit; see the global rule from 2026-10-30) ─────────
-- Staff read their own rows through RLS; only the service role writes.
REVOKE ALL ON public.ai_chat_conversations, public.ai_chat_messages, public.ai_chat_attachments
  FROM anon, authenticated;

GRANT SELECT ON public.ai_chat_conversations, public.ai_chat_messages, public.ai_chat_attachments
  TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.ai_chat_conversations, public.ai_chat_messages, public.ai_chat_attachments
  TO service_role;
