-- Migration 1526: Invoice trust release + trust-first account routing
--
-- Anita/SSL trust-first model (confirmed 2026-07-13): ALL client money is
-- collected into the TRUST account (Payload = trust-only settlement; the
-- operating account exists at Payload only as the billing method for fees).
-- Invoices (earned fees, expenses, admin fee) are billed AGAINST trust funds;
-- once billed, the money is RELEASED trust→operating by a bank-side transfer
-- the firm makes — the portal only RECORDS that release as a ledger
-- disbursement. Payload does no trust→operating transfers.
--
--   1. invoices.account_type — which account this invoice's payment link
--      routes to / which account it is billed against (default 'trust')
--   2. payment_adapter CHECK gains 'payload' (active provider; the 1503
--      constraint predates the Payload integration)
--   3. release_invoice_from_trust() — atomic disbursement + mark-paid RPC
--      (the missing "pay invoice from trust" half; mirrors 1226/1505 style)
--   4. process_invoice_payment() — provider-neutral ledger wording
--      (was hardcoded "via Confido")
--
-- Depends on: 1200_trust_accounting, 1503_invoicing_line_items.
-- Applied: dev ☑ (sandbox 2026-07-13)  prod ☐

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. INVOICE ACCOUNT ROUTING
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS account_type text NOT NULL DEFAULT 'trust'
  CHECK (account_type IN ('trust', 'operating'));

COMMENT ON COLUMN public.invoices.account_type IS
  'Account the payment link routes to and the invoice is billed against. Trust-first firms (SSL) use trust for everything.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. ALLOW payload AS A PAYMENT ADAPTER
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.invoices DROP CONSTRAINT IF EXISTS invoices_payment_adapter_check;
ALTER TABLE public.invoices ADD CONSTRAINT invoices_payment_adapter_check
  CHECK (payment_adapter IN ('confido', 'stripe', 'payload', 'manual'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. RPC: release_invoice_from_trust
-- The atomic "pay invoice from trust" action. Posts the trust ledger
-- DISBURSEMENT (release trust→operating) against the invoice and marks the
-- invoice paid, in one transaction.
--
-- Two callers/situations, same record:
--   Flow A (client holds trust funds): staff releases a SENT invoice — the
--     disbursement consumes retainer funds and the invoice becomes paid.
--   Flow B (no-trust client paid by card): webhook already posted the deposit
--     and marked the invoice PAID; staff records the release when the money
--     is actually moved at the bank.
--
-- Safety: FOR UPDATE serializes concurrent calls; one release per invoice;
-- the trust_ledger_before_insert trigger (1200) enforces per-matter IOLTA
-- balance sufficiency and rejects disbursements on non-sent/paid invoices.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.release_invoice_from_trust(
  p_invoice_id   uuid,
  p_actor        uuid,
  p_check_number text DEFAULT NULL,
  p_note         text DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_matter_id uuid;
  v_amount    numeric(10,2);
  v_status    public.invoice_status;
  v_number    text;
  v_trust_id  uuid;
  v_entry_id  uuid;
BEGIN
  -- Lock the invoice row — serializes double-clicks / concurrent releases.
  SELECT matter_id, amount, status, invoice_number
  INTO   v_matter_id, v_amount, v_status, v_number
  FROM   public.invoices
  WHERE  id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_status NOT IN ('sent', 'paid') THEN
    RAISE EXCEPTION 'Invoice % is %; only sent or paid invoices can be released from trust', v_number, v_status;
  END IF;

  -- One release per invoice.
  IF EXISTS (
    SELECT 1 FROM public.trust_ledger_entries
    WHERE invoice_id = p_invoice_id AND entry_type = 'disbursement'
  ) THEN
    RAISE EXCEPTION 'Invoice % already has a trust release recorded', v_number;
  END IF;

  SELECT id INTO v_trust_id
  FROM   public.trust_accounts
  WHERE  is_active = true
  LIMIT  1;

  IF v_trust_id IS NULL THEN
    RAISE EXCEPTION 'No active trust account configured';
  END IF;

  -- Post the disbursement. balance_after + IOLTA sufficiency enforced by the
  -- trust_ledger_before_insert trigger — an overdraw aborts the whole call.
  INSERT INTO public.trust_ledger_entries (
    trust_account_id,
    matter_id,
    entry_type,
    amount,
    description,
    invoice_id,
    payor_payee,
    check_number,
    created_by
  ) VALUES (
    v_trust_id,
    v_matter_id,
    'disbursement',
    v_amount,
    COALESCE(NULLIF(p_note, ''), 'Released from trust to operating — invoice ' || v_number),
    p_invoice_id,
    'Firm operating account',
    NULLIF(p_check_number, ''),
    p_actor
  )
  RETURNING id INTO v_entry_id;

  -- Flow A: paying a sent invoice from trust funds marks it paid.
  IF v_status = 'sent' THEN
    UPDATE public.invoices
    SET    status            = 'paid',
           payment_adapter   = COALESCE(payment_adapter, 'manual'),
           payment_reference = COALESCE(payment_reference, 'trust-release:' || v_entry_id)
    WHERE  id = p_invoice_id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'ledger_entry_id', v_entry_id, 'invoice_status', 'paid');
END;
$$;

-- Called only by the worker endpoint (service-role admin client) after a
-- can_write('trust_accounting') auth check — never directly from the browser.
REVOKE ALL ON FUNCTION public.release_invoice_from_trust(uuid, uuid, text, text) FROM PUBLIC;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. process_invoice_payment — provider-neutral wording
-- Identical to 1505 except the ledger description no longer hardcodes Confido;
-- it names the invoice's actual payment adapter.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.process_invoice_payment(
  p_invoice_id      uuid,
  p_transaction_ref text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_matter_id    uuid;
  v_amount       numeric(10,2);
  v_created_by   uuid;
  v_adapter      text;
  v_trust_id     uuid;
  v_client_name  text;
BEGIN
  -- Lock the invoice row and check it's in a payable state.
  -- FOR UPDATE prevents a double-payment race on duplicate webhook deliveries.
  SELECT matter_id, amount, created_by, payment_adapter
  INTO   v_matter_id, v_amount, v_created_by, v_adapter
  FROM   public.invoices
  WHERE  id = p_invoice_id
    AND  status NOT IN ('paid', 'void')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'already_processed_or_not_found');
  END IF;

  UPDATE public.invoices
  SET    status            = 'paid',
         payment_reference = p_transaction_ref
  WHERE  id = p_invoice_id;

  SELECT c.first_name || ' ' || c.last_name
  INTO   v_client_name
  FROM   public.matters  m
  JOIN   public.clients  c ON c.id = m.client_id
  WHERE  m.id = v_matter_id;

  SELECT id INTO v_trust_id
  FROM   public.trust_accounts
  WHERE  is_active = true
  LIMIT  1;

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
    ) VALUES (
      v_trust_id,
      v_matter_id,
      'deposit',
      v_amount,
      'Invoice payment received' || COALESCE(' via ' || initcap(v_adapter), ''),
      p_invoice_id,
      v_client_name,
      v_created_by
    );
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.process_invoice_payment(uuid, text) FROM PUBLIC;
