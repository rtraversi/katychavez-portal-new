// CF Pages Function: mirror-fb-invoice
// POST { external_id, matter_id }
// FreshBooks-first invoice flow (the biller composes/finalizes in FreshBooks): reads
// the FB invoice, mirrors it as a portal invoice, attaches a Payload trust
// pay-link, marks it Sent in FreshBooks, and best-effort stores the FB PDF as
// a matter document so the client can view it from the portal. See
// FB-FIRST-INVOICE-PLAN.md for the full design.

import { verifyAuth, sanitizeFilename, deleteR2Object, json } from './_helpers.js';
import { getBillingAdapter } from './_adapters/billing/index.js';
import { getPaymentAdapter } from './_adapters/payment/index.js';
import { getTrustFirst, defaultAccountType } from './_firm-billing-settings.js';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handleRequest(request, env);
  } catch (err) {
    console.error('[mirror-fb-invoice] Unhandled error:', err);
    return json(500, { error: 'An unexpected error occurred. Please try again.' });
  }
}

async function handleRequest(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'billing');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { external_id, matter_id } = body;
  if (!external_id) return json(400, { error: 'external_id is required' });
  if (!matter_id)   return json(400, { error: 'matter_id is required' });

  const { admin, profile } = auth;
  const warnings = [];

  const INVOICE_JOIN = `*, invoice_line_items(*), matters(id, case_number, clients(id, first_name, last_name, email))`;

  // Idempotent: (source, external_id) is also a DB-level UNIQUE constraint —
  // this check just returns the existing mirror with a friendly message
  // instead of hitting that constraint and erroring.
  const { data: existing } = await admin
    .from('invoices')
    .select(INVOICE_JOIN)
    .eq('source', 'freshbooks')
    .eq('external_id', String(external_id))
    .maybeSingle();
  if (existing) {
    return json(200, { invoice: existing, warnings: ['This FreshBooks invoice was already mirrored.'] });
  }

  const billingAdapter = getBillingAdapter(env);
  if (!billingAdapter) return json(502, { error: 'No billing adapter configured' });

  const { data: matter, error: matterErr } = await admin
    .from('matters')
    .select('id, case_number, clients(id, first_name, last_name, email)')
    .eq('id', matter_id)
    .single();
  if (matterErr || !matter) return json(404, { error: 'Matter not found' });
  const client = matter.clients;

  let inv;
  try {
    inv = await billingAdapter.getInvoice(external_id);
  } catch (err) {
    return json(502, { error: `FreshBooks error: ${err.message}` });
  }

  // Bill only the outstanding balance so a partially-paid FB invoice doesn't
  // re-request money the client already sent.
  const amount = inv.outstanding > 0 ? inv.outstanding : inv.amount;
  if (!(amount > 0)) return json(400, { error: 'This FreshBooks invoice has no outstanding balance.' });

  const now = new Date().toISOString();
  const { data: row, error: insErr } = await admin
    .from('invoices')
    .insert({
      matter_id,
      description:  inv.description || `FreshBooks invoice ${inv.invoiceNumber}`,
      amount,
      status:       'sent',
      // invoices_manage_sent_at only fires BEFORE UPDATE, not INSERT — set directly.
      sent_at:      now,
      source:       'freshbooks',
      external_id:  String(external_id),
      synced_at:    now,
      account_type: defaultAccountType(await getTrustFirst(admin)),
      created_by:   profile.id,
    })
    .select()
    .single();
  if (insErr) return json(500, { error: insErr.message });

  if (inv.lineItems?.length) {
    const { error: liErr } = await admin.from('invoice_line_items').insert(
      inv.lineItems.map((li, i) => ({
        invoice_id:  row.id,
        description: li.name || `Line ${i + 1}`,
        amount:      li.amount > 0 ? li.amount : 0.01, // amount CHECK (amount > 0); FB summary lines are non-zero in practice
        sort_order:  i,
        item_type:   'other',
      }))
    );
    if (liErr) console.error('[mirror-fb-invoice] line item insert failed (non-fatal):', liErr.message);
  }

  const clientEmail = client?.email || inv.clientEmail || null;
  const clientName  = client ? `${client.first_name} ${client.last_name}` : (inv.clientName || '');

  const updates = {};

  // Step: generate the Payload trust pay-link.
  const paymentAdapter = getPaymentAdapter(env);
  if (paymentAdapter) {
    if (!clientEmail) {
      warnings.push('No client email on file — could not generate a payment link.');
    } else {
      try {
        const link = await paymentAdapter.createPaymentRequest({
          invoiceId:   row.id,
          amount:      row.amount,
          clientEmail,
          clientName,
          description: row.description,
          accountType: row.account_type,
        });
        updates.payment_link      = link.paymentLink;
        updates.payment_reference = link.requestId;
        updates.payment_adapter   = env.PAYMENT_PROVIDER;
      } catch (err) {
        warnings.push(`Payment link failed: ${err.message}`);
      }
    }
  }

  // Step: attach the pay-link into FreshBooks' notes and mark it Sent there too.
  if (billingAdapter.sendInvoiceWithPaymentLink) {
    try {
      await billingAdapter.sendInvoiceWithPaymentLink(external_id, updates.payment_link || null, clientEmail);
    } catch (err) {
      warnings.push(`Could not attach the pay link / mark Sent in FreshBooks — do this manually there: ${err.message}`);
    }
  }

  // Step: best-effort — fetch the FB PDF and store it as a client-visible matter document.
  try {
    const pdf = await billingAdapter.getInvoicePdf?.(external_id);
    if (pdf) {
      const documentId = crypto.randomUUID();
      const fileName    = sanitizeFilename(`${inv.invoiceNumber || row.invoice_number}.pdf`);
      const r2Key       = `matters/${matter_id}/${documentId}/${fileName}`;

      await env.R2.put(r2Key, pdf.buffer, { httpMetadata: { contentType: pdf.contentType } });

      const { error: docErr } = await admin.from('documents').insert({
        id:             documentId,
        matter_id,
        uploaded_by:    null,
        name:           `Invoice ${inv.invoiceNumber || row.invoice_number}`,
        file_name:      fileName,
        file_size:      pdf.buffer.byteLength,
        r2_key:         r2Key,
        content_type:   pdf.contentType,
        doc_type:       'financial',
        status:         'received',
        source:         'freshbooks',
        client_visible: true,
        scan_status:    'skipped', // FreshBooks-generated PDF, not a client upload
      });

      if (docErr) {
        await deleteR2Object(env, r2Key).catch(() => {});
        warnings.push('Invoice PDF could not be saved to the portal — view it in FreshBooks.');
      } else {
        const { error: verErr } = await admin.from('document_versions').insert({
          document_id: documentId,
          version_no:  1,
          r2_key:      r2Key,
          file_size:   pdf.buffer.byteLength,
          source:      'freshbooks',
          created_by:  null,
        });
        if (verErr) console.error('[mirror-fb-invoice] version insert failed (non-fatal):', verErr.message);
        updates.pdf_document_id = documentId;
      }
    } else {
      warnings.push('Could not fetch the invoice PDF from FreshBooks — view it there directly.');
    }
  } catch (err) {
    console.error('[mirror-fb-invoice] PDF storage failed (non-fatal):', err.message);
    warnings.push('Invoice PDF could not be saved to the portal — view it in FreshBooks.');
  }

  if (Object.keys(updates).length) {
    const { error: updErr } = await admin.from('invoices').update(updates).eq('id', row.id);
    if (updErr) console.error('[mirror-fb-invoice] invoice update failed (non-fatal):', updErr.message);
  }

  const { data: full, error: reloadErr } = await admin
    .from('invoices')
    .select(INVOICE_JOIN)
    .eq('id', row.id)
    .single();

  return json(200, { invoice: reloadErr ? { ...row, ...updates } : full, warnings });
}
