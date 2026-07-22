-- 1106: Fix FK cascades so clients can be hard-deleted.
-- matters.client_id was RESTRICT (blocks client delete).
-- documents.matter_id was RESTRICT (would then block matter delete in the cascade chain).
-- All other matter/client child tables already use ON DELETE CASCADE or SET NULL.

ALTER TABLE public.matters
  DROP CONSTRAINT matters_client_id_fkey,
  ADD CONSTRAINT matters_client_id_fkey
    FOREIGN KEY (client_id) REFERENCES public.clients(id) ON DELETE CASCADE;

ALTER TABLE public.documents
  DROP CONSTRAINT documents_matter_id_fkey,
  ADD CONSTRAINT documents_matter_id_fkey
    FOREIGN KEY (matter_id) REFERENCES public.matters(id) ON DELETE CASCADE;
