// Firm-wide billing increment (migration 1530): billable time rounds UP to the
// nearest multiple of firm_settings.billing_increment_minutes (e.g. 6 = bill in
// 0.1 hr blocks, the legal-industry standard). 1 = bill actual tracked time.
//
// Rounding is applied at READ time (FreshBooks pull + portal-native unbilled
// time) — stored durations are never mutated, and callers surface the actual
// tracked time alongside the rounded hours so the biller sees every adjustment.

// Read the firm's increment; any missing row/column or query failure means
// "no rounding" so billing keeps working on deployments without migration 1530.
export async function getBillingIncrementMinutes(admin) {
  try {
    const { data } = await admin
      .from('firm_settings')
      .select('billing_increment_minutes')
      .limit(1)
      .maybeSingle();
    const n = Number(data?.billing_increment_minutes);
    return Number.isFinite(n) && n >= 1 ? Math.round(n) : 1;
  } catch {
    return 1;
  }
}

// Round decimal hours UP to the increment. Uses a tolerance when converting
// hours -> increment units so float noise (0.1h * 60 / 6 = 1.0000000000000002)
// can't bump an already-exact value into the next block.
export function roundHoursUpToIncrement(hours, incrementMinutes = 1) {
  const h = Number(hours);
  if (!Number.isFinite(h) || h <= 0) return 0;
  const inc = Number(incrementMinutes);
  if (!Number.isFinite(inc) || inc <= 1) return h;
  const units = Math.ceil(Math.round((h * 60 / inc) * 1e9) / 1e9);
  return Math.round(units * inc / 60 * 100) / 100;
}

// Convert a raw duration in seconds to billable decimal hours.
// increment 1 preserves the historical faithful conversion (nearest 0.01 hr);
// larger increments round UP to the block boundary.
export function secondsToBilledHours(seconds, incrementMinutes = 1) {
  const s = Number(seconds);
  if (!Number.isFinite(s) || s <= 0) return 0;
  const inc = Number(incrementMinutes);
  if (!Number.isFinite(inc) || inc <= 1) return Math.round((s / 3600) * 100) / 100;
  const units = Math.ceil(Math.round((s / (inc * 60)) * 1e9) / 1e9);
  return Math.round(units * inc / 60 * 100) / 100;
}
