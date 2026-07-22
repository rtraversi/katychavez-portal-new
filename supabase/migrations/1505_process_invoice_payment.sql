-- Migration 1505: Atomic invoice payment processing (F4 IOLTA fix)
-- Creates a SECURITY DEFINER function that marks an invoice paid AND inserts
-- the corresponding trust ledger deposit in a single transaction.
-- The webhook calls this RPC instead of two sequential API requests, so
-- there is no window where the invoice is paid but the ledger entry is missing.
-- Applied: dev ☐  prod ☐

CREATE OR REPLACE FUNCTION public.process_invoice_payment(
  p_invoice_id      uuid,
  p_transaction_ref text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_matter_id    uuid;
  v_amount       numeric(10,2);
  v_created_by   uuid;
  v_trust_id     uuid;
  v_client_name  text;
BEGIN
  -- Lock the invoice row and check it's in a payable state.
  -- FOR UPDATE prevents a double-payment race if Confido fires duplicate webhooks.
  SELECT matter_id, amount, created_by
  INTO   v_matter_id, v_amount, v_created_by
  FROM   public.invoices
  WHERE  id = p_invoice_id
    AND  status NOT IN ('paid', 'void')
  FOR UPDATE;

  -- Nothing to do if already paid, voided, or not found
  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'already_processed_or_not_found');
  END IF;

  -- Mark the invoice as paid
  UPDATE public.invoices
  SET    status            = 'paid',
         payment_reference = p_transaction_ref
  WHERE  id = p_invoice_id;

  -- Resolve the client display name for the ledger payor_payee field (best-effort)
  SELECT c.first_name || ' ' || c.last_name
  INTO   v_client_name
  FROM   public.matters  m
  JOIN   public.clients  c ON c.id = m.client_id
  WHERE  m.id = v_matter_id;

  -- Find the active trust account (one firm, one IOLTA account)
  SELECT id INTO v_trust_id
  FROM   public.trust_accounts
  WHERE  is_active = true
  LIMIT  1;

  -- Insert the trust deposit only if a trust account has been configured
  IF v_trust_id IS NOT NULL THEN
    INSERT INTO public.trust_ledger_entries (
      trust_account_id,
      matter_id,
      entry_type,
      amount,
      description,
      invoice_id,
      payor_payee,
      created_by
      -- balance_after is set by the trust_ledger_before_insert trigger
    ) VALUES (
      v_trust_id,
      v_matter_id,
      'deposit',
      v_amount,
      'Invoice payment received via Confido',
      p_invoice_id,
      v_client_name,
      v_created_by
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- Revoke direct public access; webhook uses the service-role key (admin client)
-- which bypasses RLS and can call SECURITY DEFINER functions directly.
REVOKE ALL ON FUNCTION public.process_invoice_payment(uuid, text) FROM PUBLIC;
