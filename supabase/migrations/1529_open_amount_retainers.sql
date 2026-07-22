-- Migration 1529: Open-amount retainer requests (payer enters the amount)
--
-- Some retainer links go out WITHOUT a fixed amount — the client pays what they
-- can (e.g. asked for $5,000, pays $1,000). Payload supports this by omitting the
-- `amount` on the payment link; the payer types it at checkout. For these:
--   * retainer_requests.amount is NULL until paid (was NOT NULL / CHECK > 0)
--   * open_amount flags the request as payer-entered
--   * process_retainer_payment posts the ACTUAL amount paid (read back from the
--     transaction), not the requested amount, and writes it onto the row.
-- Using the actual paid amount is also strictly more correct for fixed links.
-- Applied: dev ☐  prod ☐

ALTER TABLE public.retainer_requests ALTER COLUMN amount DROP NOT NULL;
ALTER TABLE public.retainer_requests DROP CONSTRAINT IF EXISTS retainer_requests_amount_check;
ALTER TABLE public.retainer_requests ADD CONSTRAINT retainer_requests_amount_check
  CHECK (amount IS NULL OR amount > 0);
ALTER TABLE public.retainer_requests
  ADD COLUMN IF NOT EXISTS open_amount boolean NOT NULL DEFAULT false;

-- Replace the RPC with a 3-arg version that accepts the actual paid amount. Drop
-- the old 2-arg signature first so a 2-named-arg call can't be ambiguous against
-- the new 3-arg (p_amount DEFAULT NULL).
DROP FUNCTION IF EXISTS public.process_retainer_payment(uuid, text);

CREATE OR REPLACE FUNCTION public.process_retainer_payment(
  p_retainer_id     uuid,
  p_transaction_ref text,
  p_amount          numeric DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_matter_id    uuid;
  v_amount       numeric(10,2);
  v_requested_by uuid;
  v_client_name  text;
  v_trust_id     uuid;
  v_entry_id     uuid;
  v_deposit      numeric(10,2);
BEGIN
  -- Lock the retainer row; only act if still awaiting payment.
  SELECT matter_id, amount, requested_by, client_name
  INTO   v_matter_id, v_amount, v_requested_by, v_client_name
  FROM   public.retainer_requests
  WHERE  id = p_retainer_id
    AND  status = 'pending'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'already_processed_or_not_found');
  END IF;

  -- Deposit the ACTUAL amount paid when the webhook supplies it (authoritative for
  -- open-amount links, correct for fixed links too); fall back to the requested
  -- amount. Never post a zero/blank deposit.
  v_deposit := COALESCE(p_amount, v_amount);
  IF v_deposit IS NULL OR v_deposit <= 0 THEN
    RAISE EXCEPTION 'No amount to deposit for retainer % (paid amount unknown)', p_retainer_id;
  END IF;

  -- Resolve the active trust account (one firm, one IOLTA account).
  SELECT id INTO v_trust_id
  FROM   public.trust_accounts
  WHERE  is_active = true
  LIMIT  1;

  IF v_trust_id IS NULL THEN
    RAISE EXCEPTION 'No active trust account configured — cannot post retainer deposit for %', p_retainer_id;
  END IF;

  -- Best-effort payor name for the ledger (fall back to the matter's client).
  IF v_client_name IS NULL THEN
    SELECT c.first_name || ' ' || c.last_name
    INTO   v_client_name
    FROM   public.matters m
    JOIN   public.clients c ON c.id = m.client_id
    WHERE  m.id = v_matter_id;
  END IF;

  -- Post the GROSS deposit to the trust ledger (balance_after set by trigger).
  INSERT INTO public.trust_ledger_entries (
    trust_account_id, matter_id, entry_type, amount, description, payor_payee, created_by
  ) VALUES (
    v_trust_id, v_matter_id, 'deposit', v_deposit,
    'Retainer payment received via Payload (trust)', v_client_name, v_requested_by
  )
  RETURNING id INTO v_entry_id;

  -- Mark the retainer paid, record what was actually paid, link the ledger entry.
  UPDATE public.retainer_requests
  SET    status                = 'paid',
         amount                = v_deposit,
         paid_at               = now(),
         transaction_ref       = p_transaction_ref,
         trust_ledger_entry_id = v_entry_id
  WHERE  id = p_retainer_id;

  RETURN jsonb_build_object('ok', true, 'ledger_entry_id', v_entry_id, 'amount', v_deposit);
END;
$$;

REVOKE ALL ON FUNCTION public.process_retainer_payment(uuid, text, numeric) FROM PUBLIC;
