-- Migration 1201: Migrate matters.retainer_balance → trust ledger + drop column
--
-- IMPORTANT: Run this migration AFTER:
--   1. Migration 1200 (trust_accounting) is applied
--   2. At least one trust_account row exists (firm has set up their IOLTA account)
--   3. The owner has confirmed they want to import existing retainer balances
--
-- This migration:
--   A. Provides migrate_retainer_balances(p_trust_account_id) — called from admin UI
--   B. Drops matters.retainer_balance once migration is confirmed
--
-- DO NOT apply B until A has been called and confirmed by the firm owner.
-- Applied: dev ☐  prod ☐

-- ─────────────────────────────────────────────────────────────────────────────
-- A. Migration helper function
--    Called from the Trust Accounting setup UI after the firm creates their
--    first trust account. Creates opening adjustment_credit entries for any
--    matter that had a non-zero retainer_balance.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.migrate_retainer_balances(
  p_trust_account_id  uuid,
  p_migrated_by       uuid    -- must be an Owner-role user
)
RETURNS TABLE (
  matter_id       uuid,
  amount_migrated numeric(10,2)
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_matter   record;
BEGIN
  -- Guard: only run if column still exists (idempotent)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'matters'
      AND column_name  = 'retainer_balance'
  ) THEN
    RAISE NOTICE 'matters.retainer_balance already dropped — nothing to migrate.';
    RETURN;
  END IF;

  -- Guard: skip matters that already have trust ledger entries (don't double-import)
  FOR v_matter IN
    SELECT m.id, m.retainer_balance
    FROM public.matters m
    WHERE m.retainer_balance IS NOT NULL
      AND m.retainer_balance > 0
      AND NOT EXISTS (
        SELECT 1 FROM public.trust_ledger_entries tle
        WHERE tle.matter_id = m.id
      )
  LOOP
    INSERT INTO public.trust_ledger_entries (
      trust_account_id,
      matter_id,
      entry_type,
      amount,
      description,
      created_by
    ) VALUES (
      p_trust_account_id,
      v_matter.id,
      'adjustment_credit',
      v_matter.retainer_balance,
      'Opening balance — migrated from system retainer balance',
      p_migrated_by
    );

    matter_id       := v_matter.id;
    amount_migrated := v_matter.retainer_balance;
    RETURN NEXT;
  END LOOP;
END;
$$;

COMMENT ON FUNCTION public.migrate_retainer_balances(uuid, uuid) IS
  'One-time migration: converts matters.retainer_balance into opening trust ledger entries. '
  'Call from admin UI after firm sets up their first trust account. '
  'Safe to call multiple times — skips matters that already have ledger entries.';

-- ─────────────────────────────────────────────────────────────────────────────
-- B. Drop matters.retainer_balance
--    !! UNCOMMENT AND RUN ONLY AFTER migrate_retainer_balances() HAS BEEN
--    !! CALLED AND THE FIRM HAS CONFIRMED THE MIGRATION IN THE UI !!
--    !! Separate deploy step — do not run automatically with this migration !!
-- ─────────────────────────────────────────────────────────────────────────────

-- ALTER TABLE public.matters DROP COLUMN IF EXISTS retainer_balance;
