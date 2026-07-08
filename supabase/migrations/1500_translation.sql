-- 1500_translation.sql
-- Document Translation module — stores translated documents and extracted entities.

CREATE TABLE IF NOT EXISTS public.translations (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  filename         TEXT NOT NULL,
  translator_name  TEXT,
  translated_text  TEXT,
  extracted_people JSONB,
  status           TEXT NOT NULL DEFAULT 'pending',
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS translations_created_at_idx ON public.translations (created_at DESC);

ALTER TABLE public.translations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "translations_service_only"
  ON public.translations
  FOR ALL
  USING (false);
