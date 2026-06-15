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
    RAISE NOTICE 'pg_cron extension not found — skipping orphaned upload cleanup job. Enable pg_cron on Supabase Pro to activate this.';
  END IF;
END;
$$;
