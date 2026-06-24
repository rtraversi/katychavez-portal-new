-- Migration 1204: Milestone Clawback / Reversal
--
-- Adds formal reversal tracking to flat_fee_milestones so earned milestones can be
-- reversed (client dispute, fee agreement renegotiation, refund) without mutating
-- the immutable trust ledger.
--
-- Reversal flow:
--   1. Attorney clicks Reverse on an earned milestone and provides a reason
--   2. System creates a trust_ledger_entries deposit for the milestone amount
--      (records funds returning to trust — attorney must physically transfer from operating)
--   3. Milestone is stamped: reversed_at / reversed_by / reversal_reason / reversal_entry_id
--
-- The original disbursement entry is NOT modified (immutable ledger).
-- Both the original disbursement and the reversal deposit appear in the audit trail.
-- A reversed milestone does NOT count toward the earned percentage or earned total.
--
-- Applied: dev ☐  prod ☐

ALTER TABLE public.flat_fee_milestones
  ADD COLUMN IF NOT EXISTS reversed_at       timestamptz,
  ADD COLUMN IF NOT EXISTS reversed_by       uuid REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS reversal_reason   text,
  ADD COLUMN IF NOT EXISTS reversal_entry_id uuid REFERENCES public.trust_ledger_entries(id);

COMMENT ON COLUMN public.flat_fee_milestones.reversed_at IS
  'Timestamp when an earned milestone was formally reversed. '
  'A corresponding deposit entry in trust_ledger_entries returns the funds.';
COMMENT ON COLUMN public.flat_fee_milestones.reversed_by IS
  'User who initiated the milestone reversal.';
COMMENT ON COLUMN public.flat_fee_milestones.reversal_reason IS
  'Required explanation for the reversal. Shown in audit trail and client ledger view. '
  'e.g. ''Fee dispute — client refund pending'' or ''Milestone not completed as agreed''.';
COMMENT ON COLUMN public.flat_fee_milestones.reversal_entry_id IS
  'The trust_ledger_entries deposit row created when this milestone was reversed. '
  'Links the reversal to its audit trail entry.';
