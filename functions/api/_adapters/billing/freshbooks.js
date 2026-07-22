// FreshBooks billing adapter (OAuth 2.0)
//
// FreshBooks is connected at the FIRM level via the OAuth flow in
// functions/api/freshbooks-oauth-*.js. Tokens live in the shared oauth_tokens
// table under provider='freshbooks', alongside the auto-captured account_id
// (accounting API) and business_id (time-tracking API).
//
// Env vars required when active:
//   BILLING_PROVIDER=freshbooks
//   FRESHBOOKS_CLIENT_ID       — OAuth app client ID
//   FRESHBOOKS_CLIENT_SECRET   — OAuth app client secret (worker secret)
//   FRESHBOOKS_REDIRECT_URI    — must match the app's registered redirect URI
//   SUPABASE_URL / SUPABASE_SERVICE_KEY — to read/refresh the stored tokens
//
// FreshBooks has two separate API surfaces:
//   Accounting:    api.freshbooks.com/accounting/account/{accountId}/...   → invoices, clients
//   Time tracking: api.freshbooks.com/timetracking/business/{businessId}/... → time entries
//
// ⚠️ Rotating refresh tokens: FreshBooks issues a brand-new refresh token on every
// refresh and immediately invalidates the old one. _getValidToken() therefore
// persists BOTH the new access_token AND the new refresh_token, guarded by an
// optimistic-concurrency check so two concurrent refreshes can't kill each other.

import { createClient } from '@supabase/supabase-js';
import { buildRateResolver } from '../../_billing-rates.js';
import { getBillingIncrementMinutes, secondsToBilledHours } from '../../_billing-increment.js';

const TOKEN_ENDPOINT = 'https://api.freshbooks.com/auth/oauth/token';

export class FreshbooksAdapter {
  constructor(env) {
    this.env     = env;
    this.baseUrl = 'https://api.freshbooks.com';
    this.admin   = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    });
    this._row = null; // cached oauth_tokens row for this instance
  }

  // ── Public API ────────────────────────────────────────────────────────────────

  // Pull unbilled time entries for a matter's client from FreshBooks.
  // Matches the FB client by email address. Invoicing is ALWAYS scoped to one
  // client — if we cannot resolve the client we return nothing (never every
  // client's time). Rates come from the portal's per-client billing_rates
  // (FreshBooks has none) — see _billing-rates.js for precedence.
  // Returns: [{ id, entry_date, hours, rate, description, status, effective_rate, amount, source, fb_entry_id, users }]
  async pullUnbilledTimeEntries(matterId, clientEmail, clientId = null, clientName = null) {
    await this._loadRow();

    // Match the FreshBooks client by email first. FreshBooks client records very
    // often have a BLANK email even though time is logged against them, so when
    // the email search finds nothing (or the portal has no email on file), fall
    // back to an exact first+last name match. Without this, any client whose
    // FreshBooks profile lacks a matching email pulls back nothing regardless
    // of how much unbilled time exists.
    const email   = (clientEmail || '').trim();
    const nameStr = clientName
      ? [clientName.first_name, clientName.last_name].filter(Boolean).join(' ').trim()
      : '';
    let fbClientId = email ? await this._findClientIdByEmail(email) : null;
    if (!fbClientId && nameStr) {
      fbClientId = await this._findClientIdByName(clientName);
    }
    if (!fbClientId) {
      if (!email && !nameStr) {
        throw new Error('This client has no email on file in the portal, so their FreshBooks time cannot be matched. Add the client\'s email (matching their FreshBooks profile) and try again.');
      }
      throw new Error(`No FreshBooks client matches ${email ? `"${email}"` : 'this client\'s email (none on file)'}${nameStr ? ` or the name "${nameStr}"` : ''}. Make sure this client exists in FreshBooks with the same email or name as in the portal.`);
    }

    // billed=false => not yet on an invoice ("unbilled"). client_id scopes the
    // query to this one client. team=true is REQUIRED: without it FreshBooks
    // returns only entries logged by the OAuth connection's owner, silently
    // hiding every other team member's time. Page through the results so we
    // never stop at FreshBooks' default first page (15 entries) and silently
    // drop the rest.
    const raw = await this._getAllPages(
      `/timetracking/business/${this.businessId}/time_entries`,
      { billed: 'false', team: 'true', client_id: String(fbClientId) },
      (d) => (d?.data?.time_entries || d?.time_entries || []),
      (d) => (d?.data?.meta || d?.meta || null),
    );

    // Hard guarantee: only this client's entries, even if the API ignores the
    // client_id query filter.
    const scoped = raw.filter(e => String(e.client_id) === String(fbClientId));

    // Resolve each logger's per-client rate from the portal (FreshBooks entries
    // carry identity_id = who logged the time). No clientId → no portal rates,
    // so we fall back to the provider's billable_rate (0 today).
    const [resolver, increment] = await Promise.all([
      clientId ? buildRateResolver(this.admin, clientId) : Promise.resolve(null),
      this._getBillingIncrement(),
    ]);

    return scoped.map(e => {
      const seconds  = e.duration || 0;
      // FreshBooks stores duration in SECONDS and quantizes short entries to the
      // nearest minute — a "0.01h" entry is stored as 60s and correctly reads as
      // 0.02h here (36s would be 0.01h). This is faithful, not a doubling bug.
      const actualHours = Math.round((seconds / 3600) * 100) / 100;
      // Billable hours round UP to the firm's billing increment (e.g. 6 min =
      // 0.1 hr blocks). actual_hours keeps the tracked time so the UI can show
      // the human exactly what was rounded — the portal never hides it.
      const hours    = secondsToBilledHours(seconds, increment);
      // An entry flagged non-billable in FreshBooks is meant to appear on the
      // invoice but NOT charge. Surface it with a zero rate/amount and a billable
      // flag so the UI can show it as "No charge" instead of billing for it.
      const billable = e.billable !== false;
      const fbRate   = Number(e.billable_rate) || 0;
      const rate     = billable
        ? (resolver ? resolver.forIdentity(e.identity_id, fbRate) : fbRate)
        : 0;
      const amount   = billable ? Math.round(hours * rate * 100) / 100 : 0;
      return {
        id:             `fb_${e.id}`,
        entry_date:     e.started_at ? e.started_at.split('T')[0] : null,
        hours,
        actual_hours:     actualHours,
        duration_seconds: seconds,
        rate:           rate || null,
        description:    e.note || '',
        status:         'unbilled',
        billable,
        effective_rate: rate,
        amount,
        source:         'freshbooks',
        fb_entry_id:    e.id,
        identity_id:    e.identity_id ?? null,
        users:          null,
      };
    });
  }

  // Create an invoice in FreshBooks from portal invoice data.
  // Returns: { externalId: string, invoiceNumber: string }
  async createInvoice(invoice, lineItems, client) {
    await this._loadRow();

    const fbClientId = client?.email
      ? await this._findClientIdByEmail(client.email)
      : null;

    if (!fbClientId) {
      throw new Error(
        `FreshBooks client not found for email: ${client?.email || '(none)'}. ` +
        'Ensure the client exists in FreshBooks with the same email address as in the portal.'
      );
    }

    const fbLines = lineItems.map((li, i) => ({
      name:        li.description || `Service ${i + 1}`,
      unit_cost:   {
        amount: String(li.rate || (li.hours ? Number((li.amount / li.hours).toFixed(2)) : li.amount)),
        code:   'USD',
      },
      // FreshBooks' field is `qty` — an unknown `quantity` key is silently
      // dropped and every line defaults to qty 0, zeroing the whole invoice.
      // Numeric columns arrive from Postgres as strings ("0.10"), so coerce.
      qty:         li.hours ? Number(li.hours) : 1,
      description: li.description || '',
      type:        0, // 0 = line item, 1 = time entry reference
    }));

    const body = {
      invoice: {
        customerid:  fbClientId,
        // Required by the FreshBooks API (422 errno 1001 without it). Use the
        // portal invoice's creation date; both Postgres ("YYYY-MM-DD hh:…") and
        // ISO ("YYYY-MM-DDThh:…") timestamps slice to the YYYY-MM-DD FB wants.
        create_date: (invoice.created_at || new Date().toISOString()).slice(0, 10),
        lines:       fbLines,
        notes:       invoice.description || '',
        terms:       '',
        due_offset_days: invoice.due_date
          ? Math.max(0, Math.round((new Date(invoice.due_date) - Date.now()) / 86400000))
          : 30,
        status:      1, // 1 = draft in FreshBooks
      },
    };

    const res     = await this._post(`/accounting/account/${this.accountId}/invoices/invoices`, body);
    const created = res?.response?.result?.invoice;
    if (!created) throw new Error('FreshBooks returned no invoice in response');

    return {
      externalId:    String(created.id),
      invoiceNumber: created.invoice_number || String(created.id),
    };
  }

  // Append a payment link to the FreshBooks invoice notes, then have
  // FreshBooks EMAIL the invoice to the client with its PDF attached
  // (action_email marks it sent as a side effect). Setting status 2 alone
  // does NOT send anything — it only flips the status — so a recipient email
  // is required for the client to actually receive the invoice; without one
  // we fall back to mark-as-sent only.
  //
  // Notes are PRESERVED: in the FB-first flow the invoice's notes are the
  // biller's own text, so we read the live notes and append the pay line — replacing
  // only a previous "Pay online:" line (on resend the old link is superseded
  // and must not linger). Never overwrite what the firm wrote.
  async sendInvoiceWithPaymentLink(externalId, paymentLink, recipientEmail) {
    await this._loadRow();
    let note = null;
    if (paymentLink) {
      let existing = '';
      try {
        const res = await this._get(
          `/accounting/account/${this.accountId}/invoices/invoices/${externalId}`
        );
        existing = res?.response?.result?.invoice?.notes || '';
      } catch (err) {
        // Read failure → send with the link-only note rather than blocking.
        console.error(`[freshbooks] could not read existing notes for ${externalId} (non-fatal):`, err.message);
      }
      const kept = existing
        .split('\n')
        .filter(l => !l.trim().startsWith('Pay online:'))
        .join('\n')
        .trim();
      const payLine = `Pay online: ${paymentLink}`;
      note = kept ? `${kept}\n\n${payLine}` : payLine;
    }
    const invoice = recipientEmail
      ? {
          action_email:      true,
          email_recipients:  [recipientEmail],
          email_include_pdf: true,
          ...(note ? { notes: note } : {}),
        }
      : { status: 2, ...(note ? { notes: note } : {}) };
    await this._put(
      `/accounting/account/${this.accountId}/invoices/invoices/${externalId}`,
      { invoice }
    );
  }

  // Mark a FreshBooks invoice as sent without modifying notes.
  async sendInvoice(externalId) {
    await this._loadRow();
    await this._put(
      `/accounting/account/${this.accountId}/invoices/invoices/${externalId}`,
      { invoice: { status: 2 } }
    );
  }

  // ── FreshBooks-first invoice flow (biller composes in FB; portal mirrors) ─────

  // List invoices not yet paid, INCLUDING drafts — the FB-first workflow is
  // "compose in FreshBooks, leave it as a draft, send from the portal", so a
  // draft means ready-to-send, and the biller never touches FB's own Send button
  // (which would email the client without the pay link).
  // FreshBooks' v3_status: draft/sent/viewed/partial/overdue/paid/… — we keep
  // everything except 'paid'.
  // Returns: [{ externalId, invoiceNumber, clientName, clientEmail, amount,
  //             outstanding, description, createdDate, dueDate, v3Status }]
  async listUnpaidInvoices() {
    await this._loadRow();
    const EXCLUDED = new Set(['paid']);

    const raw = await this._getAllPages(
      `/accounting/account/${this.accountId}/invoices/invoices`,
      {},
      (d) => (d?.response?.result?.invoices || []),
      (d) => ({ pages: d?.response?.result?.pages }),
    );

    return raw
      .filter(inv => !EXCLUDED.has(String(inv.v3_status || '').toLowerCase()))
      .map(inv => this._normalizeInvoice(inv));
  }

  // Read one invoice, with line items. Returns the same normalized shape as
  // listUnpaidInvoices() plus lineItems.
  async getInvoice(externalId) {
    await this._loadRow();
    const res = await this._get(
      `/accounting/account/${this.accountId}/invoices/invoices/${externalId}?include[]=lines`
    );
    const inv = res?.response?.result?.invoice;
    if (!inv) throw new Error(`FreshBooks invoice ${externalId} not found`);
    return this._normalizeInvoice(inv);
  }

  // NOTE: field names below (fname/lname/organization/email, amount/outstanding
  // as {amount,code} objects) mirror the shape FreshBooks' Clients endpoint uses
  // elsewhere in this file (_findClientIdByName). Not yet verified against a
  // live Invoice response — confirm during sandbox E2E and adjust if FreshBooks
  // nests these differently.
  _normalizeInvoice(inv) {
    const clientName = inv.organization
      || [inv.fname, inv.lname].filter(Boolean).join(' ')
      || null;
    return {
      externalId:    String(inv.id ?? inv.invoiceid),
      invoiceNumber: inv.invoice_number || String(inv.id ?? inv.invoiceid),
      clientName,
      clientEmail:   inv.email || null,
      amount:        Number(inv.amount?.amount ?? inv.amount) || 0,
      outstanding:   Number(inv.outstanding?.amount ?? inv.outstanding) || 0,
      description:   inv.notes || clientName || '',
      createdDate:   inv.create_date || null,
      dueDate:       inv.due_date || null,
      v3Status:      inv.v3_status || null,
      lineItems: (inv.lines || []).map(l => ({
        name:      l.name || l.description || '',
        amount:    Number(l.amount?.amount ?? l.amount) || 0,
        quantity:  Number(l.qty) || 1,
        unitCost:  Number(l.unit_cost?.amount ?? l.unit_cost) || 0,
      })),
    };
  }

  // Best-effort PDF fetch for a sent FreshBooks invoice, to mirror into the
  // portal's own document storage. NEVER throws — the mirror/pay-link/send
  // flow must succeed even if this fails, since neither the exact share-link
  // query syntax nor whether it serves a PDF directly is documented by
  // FreshBooks. Returns { buffer, contentType } or null.
  async getInvoicePdf(externalId) {
    try {
      await this._loadRow();
      const res = await this._get(
        `/accounting/account/${this.accountId}/invoices/invoices/${externalId}?share_link&share_method=share_link`
      );
      const inv = res?.response?.result?.invoice;
      const shareLink = inv?.share_link || inv?.invoice_link || inv?.links?.client_view || null;
      if (!shareLink) return null;

      const pdfRes = await fetch(shareLink);
      if (!pdfRes.ok) return null;
      const contentType = pdfRes.headers.get('content-type') || '';
      if (!contentType.toLowerCase().includes('application/pdf')) return null;

      return { buffer: await pdfRes.arrayBuffer(), contentType: 'application/pdf' };
    } catch (err) {
      console.error(`[freshbooks] getInvoicePdf(${externalId}) failed (non-fatal):`, err.message);
      return null;
    }
  }

  // Record a retainer payment as a PREPAYMENT credit under the FreshBooks
  // client, so FreshBooks shows the money as available to apply against
  // future invoices (instead of someone hand-entering it as an invoice, which
  // makes the client look like they OWE the retainer).
  // ⚠️ Unverified against a live FreshBooks account: 'prepayment' is in FB's
  // documented credit_type enum, but the create semantics for that type are
  // thinly documented — so this ships behind firm_settings.fb_auto_prepayment
  // (default OFF). Throws on failure; callers treat it as best-effort.
  // clientName is a { first_name, last_name } object (same as _findClientIdByName).
  async createPrepaymentCredit({ clientEmail, clientName, amount, date, note }) {
    await this._loadRow();

    let fbClientId = clientEmail ? await this._findClientIdByEmail(clientEmail) : null;
    if (!fbClientId && clientName) fbClientId = await this._findClientIdByName(clientName);
    if (!fbClientId) {
      throw new Error(
        `No FreshBooks client matches ${clientEmail ? `"${clientEmail}"` : 'this client'} — record the prepayment there manually.`
      );
    }

    const desc = note || 'Retainer payment received via portal';
    const body = {
      credit_note: {
        clientid:      fbClientId,
        credit_type:   'prepayment',
        create_date:   (date || new Date().toISOString()).slice(0, 10),
        currency_code: 'USD',
        notes:         desc,
        // Amount is carried on a line, mirroring how invoice totals work.
        lines: [{
          name:        'Retainer payment',
          description: desc,
          unit_cost:   { amount: String(amount), code: 'USD' },
          qty:         1,
        }],
      },
    };

    const res = await this._post(
      `/accounting/account/${this.accountId}/credit_notes/credit_notes`,
      body
    );
    const created = res?.response?.result?.credit_note;
    if (!created) throw new Error('FreshBooks returned no credit_note in response');
    return {
      creditId:     String(created.id),
      creditNumber: created.credit_number || String(created.id),
    };
  }

  // Firm billing increment for round-up (own method so tests can stub it out
  // along with the rest of the DB/network machinery).
  async _getBillingIncrement() {
    return getBillingIncrementMinutes(this.admin);
  }

  // ── Token / connection management ───────────────────────────────────────────────

  // Load the firm's single freshbooks row (token + accountId/businessId) and cache it.
  async _loadRow() {
    if (this._row) return this._row;

    const { data, error } = await this.admin
      .from('oauth_tokens')
      .select('access_token, refresh_token, token_expiry, account_id, business_id')
      .eq('provider', 'freshbooks')
      .order('updated_at', { ascending: false })
      .limit(1);

    if (error) throw new Error(`FreshBooks token lookup failed: ${error.message}`);
    const row = data?.[0];
    if (!row) throw new Error('FreshBooks is not connected. Connect it in Settings → Billing & Payments.');

    this.accountId  = row.account_id;
    this.businessId = row.business_id;
    this._row = row;
    return row;
  }

  // Return a valid access token, refreshing (and persisting the rotated refresh
  // token) if within 60s of expiry.
  async _getValidToken() {
    const row = await this._loadRow();

    const expiryMs = row.token_expiry ? new Date(row.token_expiry).getTime() : 0;
    if (expiryMs > Date.now() + 60_000) return row.access_token;

    const res = await fetch(TOKEN_ENDPOINT, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Api-Version': 'alpha' },
      body:    JSON.stringify({
        grant_type:    'refresh_token',
        client_id:     this.env.FRESHBOOKS_CLIENT_ID,
        client_secret: this.env.FRESHBOOKS_CLIENT_SECRET,
        refresh_token: row.refresh_token,
        redirect_uri:  this.env.FRESHBOOKS_REDIRECT_URI,
      }),
    });

    if (!res.ok) {
      // A concurrent request may have already rotated the token, invalidating
      // ours. Re-read the row: if it now holds a fresh token, use that.
      const fresh = await this._reloadRow();
      const freshMs = fresh?.token_expiry ? new Date(fresh.token_expiry).getTime() : 0;
      if (fresh && freshMs > Date.now() + 60_000) return fresh.access_token;
      throw new Error(`FreshBooks token refresh failed (${res.status}). Reconnect FreshBooks in Settings → Billing & Payments.`);
    }

    const tokens    = await res.json();
    const newExpiry = new Date(Date.now() + (tokens.expires_in || 43200) * 1000).toISOString();

    // Single-flight guard: only write if the row still holds the refresh token we
    // used. If 0 rows update, another request refreshed first — use its token.
    const { data: updated, error: updErr } = await this.admin
      .from('oauth_tokens')
      .update({
        access_token:  tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expiry:  newExpiry,
        updated_at:    new Date().toISOString(),
      })
      .eq('provider', 'freshbooks')
      .eq('refresh_token', row.refresh_token)
      .select('access_token, refresh_token, token_expiry, account_id, business_id');

    if (updErr) throw new Error(`FreshBooks token persist failed: ${updErr.message}`);

    if (!updated || updated.length === 0) {
      const fresh = await this._reloadRow();
      if (fresh?.access_token) return fresh.access_token;
      // Fall back to the token we just fetched (row was deleted mid-flight).
      return tokens.access_token;
    }

    this._row = updated[0];
    this.accountId  = this._row.account_id;
    this.businessId = this._row.business_id;
    return tokens.access_token;
  }

  async _reloadRow() {
    this._row = null;
    try {
      return await this._loadRow();
    } catch {
      return null;
    }
  }

  // ── FreshBooks HTTP helpers ─────────────────────────────────────────────────────

  async _findClientIdByEmail(email) {
    const res = await this._get(
      `/accounting/account/${this.accountId}/users/clients?search[email]=${encodeURIComponent(email)}`
    );
    return res?.response?.result?.clients?.[0]?.id || null;
  }

  // Fallback match when the FreshBooks client has no (matching) email: exact,
  // case-insensitive first+last name across all clients (org name as a backstop).
  async _findClientIdByName(name) {
    const first = (name?.first_name || '').trim().toLowerCase();
    const last  = (name?.last_name  || '').trim().toLowerCase();
    if (!first && !last) return null;
    const full = [first, last].filter(Boolean).join(' ');

    const clients = await this._getAllPages(
      `/accounting/account/${this.accountId}/users/clients`,
      {},
      (d) => (d?.response?.result?.clients || []),
      (d) => ({ pages: d?.response?.result?.pages }),
    );
    const norm = (s) => (s || '').trim().toLowerCase();
    const match = clients.find(c =>
      (norm(c.fname) === first && norm(c.lname) === last) ||
      (!!full && norm(c.organization) === full)
    );
    return match?.id || null;
  }

  // Follow FreshBooks pagination until every row is collected. `extract` pulls
  // the array out of a page; `metaOf` pulls the { pages } meta (null when a page
  // carries no meta — e.g. tests/mocks — in which case we treat it as one page).
  async _getAllPages(basePath, params, extract, metaOf, maxPages = 50) {
    const all = [];
    for (let page = 1; page <= maxPages; page++) {
      const qs   = new URLSearchParams({ ...params, page: String(page), per_page: '100' });
      const data = await this._get(`${basePath}?${qs}`);
      const rows = extract(data) || [];
      all.push(...rows);
      const pages = Number(metaOf?.(data)?.pages) || 0;
      if (!pages || page >= pages || rows.length === 0) break;
    }
    return all;
  }

  async _get(path)        { return this._request('GET',  path); }
  async _post(path, body) { return this._request('POST', path, body); }
  async _put(path, body)  { return this._request('PUT',  path, body); }

  async _request(method, path, body) {
    const token = await this._getValidToken();

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type':  'application/json',
        'Api-Version':   'alpha',
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401) {
      throw new Error('FreshBooks authorization was rejected. Reconnect FreshBooks in Settings → Billing & Payments.');
    }
    if (!res.ok) {
      throw new Error(`FreshBooks API error ${res.status}: ${await res.text()}`);
    }
    return res.json();
  }
}
