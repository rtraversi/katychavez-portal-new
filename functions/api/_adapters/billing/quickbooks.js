// QuickBooks Online billing adapter
// Env vars required when active:
//   QB_CLIENT_ID, QB_CLIENT_SECRET
//   QB_REALM_ID
//   QB_ACCESS_TOKEN, QB_REFRESH_TOKEN (or KV-stored)
// Docs: https://developer.intuit.com/app/developer/qbo/docs/get-started

export class QuickbooksAdapter {
  constructor(env) {
    this.env = env;
    this.baseUrl = 'https://quickbooks.api.intuit.com/v3/company';
    this.realmId = env.QB_REALM_ID;
  }

  // Pull unbilled time entries for a matter from QuickBooks.
  // Returns: [{ id, description, hours, rate, amount, date }]
  async pullUnbilledTimeEntries(matterId) {
    throw new Error('QuickBooks adapter: pullUnbilledTimeEntries not yet implemented');
  }

  // Create an invoice in QuickBooks from portal invoice data.
  // Returns: { externalId: string, invoiceNumber: string }
  async createInvoice(invoice, lineItems, client) {
    throw new Error('QuickBooks adapter: createInvoice not yet implemented');
  }

  // Mark a QuickBooks invoice as paid.
  async markInvoicePaid(externalId, paymentData) {
    throw new Error('QuickBooks adapter: markInvoicePaid not yet implemented');
  }

  async _request(method, path, body) {
    const token = this.env.QB_ACCESS_TOKEN;
    const res = await fetch(`${this.baseUrl}/${this.realmId}${path}`, {
      method,
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok) throw new Error(`QuickBooks API error ${res.status}: ${await res.text()}`);
    return res.json();
  }
}
