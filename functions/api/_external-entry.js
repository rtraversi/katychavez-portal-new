// Provider time-entry ids as the pull layer names them: "fb_344181434"
// (QuickBooks later: "qb_…"). Deliberately disjoint from portal uuids so a
// line item carries exactly one of time_entry_id / external_entry_id.
export const isExternalEntryId = (v) =>
  typeof v === 'string' && /^[a-z]+_\d+$/i.test(v);

// Provider entry ids already sitting on a live (non-void) invoice. These must
// not be offered as unbilled again, and creating a new line for one must be
// rejected — the provider (FreshBooks) never learns its entries were invoiced
// here, so its own billed flag stays false forever (migration 1533).
export async function fetchConsumedExternalIds(admin) {
  const { data, error } = await admin
    .from('invoice_line_items')
    .select('external_entry_id, invoices!inner(status)')
    .not('external_entry_id', 'is', null)
    .neq('invoices.status', 'void');
  if (error) throw new Error(error.message);
  return new Set((data || []).map(r => r.external_entry_id));
}
