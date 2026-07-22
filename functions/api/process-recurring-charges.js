// Recurring-charge cron — generates the monthly administrative-fee invoices.
//
// Runs on the daily cron (see _worker.js scheduled()). For each ACTIVE
// recurring_charge it creates ONE draft invoice per calendar month, on or after
// the charge's day_of_month, guarded by last_charged_on so it never double-bills
// and self-heals if a day is missed. It only ever creates DRAFT invoices — a
// human still reviews and sends them; nothing is charged automatically.
//
// The fee is per-client but invoices are matter-scoped, so it attaches to the
// client's most-recent matter.

import { createClient } from '@supabase/supabase-js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
                'July', 'August', 'September', 'October', 'November', 'December'];

export async function run(env, adminOverride) {
  const admin = adminOverride || createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const now = new Date();
  const y   = now.getUTCFullYear();
  const mo  = now.getUTCMonth();       // 0-based
  const day = now.getUTCDate();

  const { data: charges, error } = await admin
    .from('recurring_charges')
    .select('id, client_id, description, amount, day_of_month, last_charged_on')
    .eq('active', true)
    .eq('frequency', 'monthly');

  if (error) {
    console.error('[recurring-charges] load failed:', error.message);
    return { created: 0 };
  }

  let created = 0;
  for (const c of charges || []) {
    // Not due yet this month.
    if (day < (c.day_of_month || 1)) continue;

    // Already billed this calendar month.
    if (c.last_charged_on) {
      const lc = new Date(`${c.last_charged_on}T00:00:00Z`);
      if (lc.getUTCFullYear() === y && lc.getUTCMonth() === mo) continue;
    }

    // Attach to the client's most-recent matter (invoices are matter-scoped).
    const { data: matter } = await admin
      .from('matters')
      .select('id')
      .eq('client_id', c.client_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!matter) {
      console.warn(`[recurring-charges] no matter for client ${c.client_id} — skipping`);
      continue;
    }

    const label = `${c.description} — ${MONTHS[mo]} ${y}`;

    const { data: inv, error: invErr } = await admin
      .from('invoices')
      .insert({ matter_id: matter.id, description: label, amount: c.amount, source: 'portal', status: 'draft' })
      .select('id')
      .single();

    if (invErr) {
      console.error('[recurring-charges] invoice insert failed:', invErr.message);
      continue;
    }

    const { error: liErr } = await admin
      .from('invoice_line_items')
      .insert({ invoice_id: inv.id, description: label, amount: c.amount, rate: c.amount, item_type: 'flat_fee', sort_order: 0 });
    if (liErr) console.error('[recurring-charges] line item insert failed:', liErr.message);

    const stamp = `${y}-${String(mo + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    await admin.from('recurring_charges').update({ last_charged_on: stamp }).eq('id', c.id);

    created++;
  }

  console.log(`[recurring-charges] created ${created} draft invoice(s)`);
  return { created };
}
