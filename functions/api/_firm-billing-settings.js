// Firm-level billing switches (migration 1536). Both exist to keep SSL's
// operating model from being the template's hardcoded assumption — see
// CONSOLIDATION-ANALYSIS.md §2.
//
// Every read here is defensive in the same way as getBillingIncrementMinutes:
// a missing row, missing column, or failed query must degrade to the behaviour
// the portal had BEFORE 1536, so a deployment that hasn't applied the migration
// keeps working unchanged.

// Trust-first (IOLTA) routing. Before 1536 the value was hardcoded 'trust' in
// four endpoints, so the pre-migration behaviour is trust_first = true — which
// is also the conservative default (unearned client funds belong in trust).
export async function getTrustFirst(admin) {
  try {
    const { data } = await admin
      .from('firm_settings')
      .select('trust_first')
      .limit(1)
      .maybeSingle();
    // Only an explicit false turns it off; undefined/null => trust-first.
    return data?.trust_first !== false;
  } catch {
    return true;
  }
}

// The account an invoice or retainer routes to when nothing overrides it.
export function defaultAccountType(trustFirst) {
  return trustFirst ? 'trust' : 'operating';
}

// Which invoice-authoring workflow this firm uses.
//
// Returns 'portal' | 'freshbooks_first' | null. **null means "not configured"**
// and callers must fall back to showing BOTH workflows — that is the exact
// pre-1536 behaviour. Defaulting a missing column to 'portal' instead would
// hide the From-FreshBooks panel on any FB-first deployment that hasn't applied
// the migration yet (i.e. SSL), which is a live-billing regression.
export async function getBillingMode(admin) {
  try {
    const { data } = await admin
      .from('firm_settings')
      .select('billing_mode')
      .limit(1)
      .maybeSingle();
    const mode = data?.billing_mode;
    return mode === 'portal' || mode === 'freshbooks_first' ? mode : null;
  } catch {
    return null;
  }
}
