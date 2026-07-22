// Unit tests for the pre-billing review batch (2026-07-14):
//   1. /api/add-time-entry — manual minutes-based entries from the billing screen
//   2. /api/update-draft-invoice — draft-only editing: remove lines (releasing
//      time/expenses back to unbilled), add lines, header edits, guards
//   3. FreshbooksAdapter.sendInvoiceWithPaymentLink — must actually EMAIL the
//      client (action_email + PDF); bare status 2 sends nothing
import { describe, it, expect, vi, beforeEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({
  verifyAuth:      vi.fn(),
  makeAdminClient: vi.fn(),
  json: (status, body) => new Response(JSON.stringify(body), {
    status, headers: { 'Content-Type': 'application/json' },
  }),
}));
vi.mock('../../functions/api/_helpers.js', () => helpersMock);

import { onRequest as addTimeEntry }       from '../../functions/api/add-time-entry.js';
import { onRequest as updateDraftInvoice } from '../../functions/api/update-draft-invoice.js';
import { FreshbooksAdapter }               from '../../functions/api/_adapters/billing/freshbooks.js';

function post(path, body) {
  return new Request(`http://portal.test${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const U = (n) => `${n}${n}${n}${n}${n}${n}${n}${n}-${n}${n}${n}${n}-4${n}${n}${n}-8${n}${n}${n}-${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}${n}`;
const UUID_TIME = U(1);
const UUID_EXP  = U(2);
const UUID_LINE_TIME = U(3);
const UUID_LINE_EXP  = U(4);
const UUID_LINE_LEGACY = U(5);

beforeEach(() => {
  vi.clearAllMocks();
  helpersMock.verifyAuth.mockResolvedValue({ profile: { id: 'user-1' } });
});

// ── /api/add-time-entry ───────────────────────────────────────────────────────

function timeEntryAdmin({ matterExists = true } = {}) {
  const state = { inserted: null };
  const admin = {
    from(table) {
      if (table === 'matters') {
        return {
          select() { return this; },
          eq()     { return this; },
          single: async () => ({ data: matterExists ? { id: 'm1' } : null, error: null }),
        };
      }
      if (table === 'time_entries') {
        return {
          insert(row) {
            state.inserted = row;
            return { select: () => ({ single: async () => ({ data: { id: 'te-1', ...row }, error: null }) }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { admin, state };
}

describe('/api/add-time-entry', () => {
  it('converts minutes to 2dp hours and stores an unbilled portal entry', async () => {
    const { admin, state } = timeEntryAdmin();
    helpersMock.makeAdminClient.mockReturnValue(admin);

    const res = await addTimeEntry({
      request: post('/api/add-time-entry', {
        matter_id: 'm1', user_id: 'u1', description: 'Call with client', minutes: 12,
      }),
      env: {},
    });
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(state.inserted).toMatchObject({
      matter_id: 'm1', user_id: 'u1', description: 'Call with client',
      hours: 0.2, rate: null, status: 'unbilled', created_by: 'user-1',
    });
    expect(body.time_entry.id).toBe('te-1');
  });

  it('a 1-minute entry stores the 0.02h floor (hours column is 2dp, must stay > 0)', async () => {
    const { admin, state } = timeEntryAdmin();
    helpersMock.makeAdminClient.mockReturnValue(admin);
    await addTimeEntry({
      request: post('/api/add-time-entry', { matter_id: 'm1', user_id: 'u1', description: 'x', minutes: 1 }),
      env: {},
    });
    expect(state.inserted.hours).toBe(0.02);
  });

  it('no_charge stores an explicit rate of 0 (wins over the per-client resolver at read)', async () => {
    const { admin, state } = timeEntryAdmin();
    helpersMock.makeAdminClient.mockReturnValue(admin);
    await addTimeEntry({
      request: post('/api/add-time-entry', { matter_id: 'm1', user_id: 'u1', description: 'Courtesy', minutes: 6, no_charge: true }),
      env: {},
    });
    expect(state.inserted.rate).toBe(0);
  });

  it.each([
    [{ user_id: 'u1', description: 'x', minutes: 5 },                 /matter_id/],
    [{ matter_id: 'm1', description: 'x', minutes: 5 },               /user_id/],
    [{ matter_id: 'm1', user_id: 'u1', minutes: 5 },                  /description/i],
    [{ matter_id: 'm1', user_id: 'u1', description: 'x', minutes: 0 },   /minutes/i],
    [{ matter_id: 'm1', user_id: 'u1', description: 'x', minutes: 2000 },/minutes/i],
  ])('rejects invalid input %#', async (body, msg) => {
    const res = await addTimeEntry({ request: post('/api/add-time-entry', body), env: {} });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(msg);
  });

  it('404s on an unknown matter', async () => {
    const { admin } = timeEntryAdmin({ matterExists: false });
    helpersMock.makeAdminClient.mockReturnValue(admin);
    const res = await addTimeEntry({
      request: post('/api/add-time-entry', { matter_id: 'nope', user_id: 'u1', description: 'x', minutes: 5 }),
      env: {},
    });
    expect(res.status).toBe(404);
  });
});

// ── /api/update-draft-invoice ─────────────────────────────────────────────────

function draftAdmin({ invoice, consumedRows = [] }) {
  const ops = { deletedLineIds: null, timeUpdates: [], expenseUpdates: [], insertedLines: null, headerPatch: null };
  const fresh = { ...invoice, refreshed: true };
  let selects = 0;
  const admin = {
    from(table) {
      if (table === 'invoices') {
        return {
          select() { return this; },
          eq()     { return this; },
          single: async () => ({ data: selects++ === 0 ? invoice : fresh, error: null }),
          update(patch) { ops.headerPatch = patch; return { eq: async () => ({ error: null }) }; },
        };
      }
      if (table === 'invoice_line_items') {
        return {
          delete() {
            return { in: (_c, ids) => ({ eq: async () => { ops.deletedLineIds = ids; return { error: null }; } }) };
          },
          insert: async (rows) => { ops.insertedLines = rows; return { error: null }; },
          // consumed-external-ids lookup (1533): select().not().neq() → rows
          select() {
            const c = { not: () => c, neq: () => c, then: (resolve) => resolve({ data: consumedRows, error: null }) };
            return c;
          },
        };
      }
      if (table === 'time_entries') {
        return { update(vals) { return { in: async (_c, ids) => { ops.timeUpdates.push({ vals, ids }); return { error: null }; } }; } };
      }
      if (table === 'expenses') {
        return {
          update(vals) {
            const rec = { vals, ids: null };
            ops.expenseUpdates.push(rec);
            const c = {
              in: (_c, ids) => { rec.ids = ids; return c; },
              eq: () => c,
              then: (resolve) => resolve({ error: null }),
            };
            return c;
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
  return { admin, ops };
}

const DRAFT = {
  id: 'inv-1', status: 'draft', matter_id: 'm1',
  invoice_line_items: [
    { id: UUID_LINE_TIME,   time_entry_id: UUID_TIME, expense_id: null,     item_type: 'time',    amount: 500, sort_order: 0 },
    { id: UUID_LINE_EXP,    time_entry_id: null,      expense_id: UUID_EXP, item_type: 'expense', amount: 350, sort_order: 1 },
    { id: UUID_LINE_LEGACY, time_entry_id: null,      expense_id: null,     item_type: 'expense', amount: 25,  sort_order: 2 },
  ],
};

describe('/api/update-draft-invoice', () => {
  it('rejects non-draft invoices', async () => {
    const { admin } = draftAdmin({ invoice: { ...DRAFT, status: 'sent' } });
    helpersMock.makeAdminClient.mockReturnValue(admin);
    const res = await updateDraftInvoice({
      request: post('/api/update-draft-invoice', { invoice_id: 'inv-1', description: 'x' }), env: {},
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/only draft/i);
  });

  it('removing lines releases the time entry and expense, and flags legacy expense lines', async () => {
    const { admin, ops } = draftAdmin({ invoice: DRAFT });
    helpersMock.makeAdminClient.mockReturnValue(admin);

    const res = await updateDraftInvoice({
      request: post('/api/update-draft-invoice', {
        invoice_id: 'inv-1',
        remove_line_item_ids: [UUID_LINE_EXP, UUID_LINE_LEGACY],
      }),
      env: {},
    });
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(ops.deletedLineIds).toEqual([UUID_LINE_EXP, UUID_LINE_LEGACY]);
    // the linked expense is un-billed…
    expect(ops.expenseUpdates[0].vals).toMatchObject({ billed: false, invoice_id: null });
    expect(ops.expenseUpdates[0].ids).toEqual([UUID_EXP]);
    // …no time entries touched (none removed), legacy line raises a warning
    expect(ops.timeUpdates).toHaveLength(0);
    expect(body.warnings.join(' ')).toMatch(/expense linking/i);
    expect(body.invoice.refreshed).toBe(true);
  });

  it('removing a time line returns its entry to unbilled', async () => {
    const { admin, ops } = draftAdmin({ invoice: DRAFT });
    helpersMock.makeAdminClient.mockReturnValue(admin);
    await updateDraftInvoice({
      request: post('/api/update-draft-invoice', { invoice_id: 'inv-1', remove_line_item_ids: [UUID_LINE_TIME] }), env: {},
    });
    expect(ops.timeUpdates[0]).toMatchObject({ vals: { status: 'unbilled' }, ids: [UUID_TIME] });
  });

  it('refuses to remove every line item', async () => {
    const { admin } = draftAdmin({ invoice: DRAFT });
    helpersMock.makeAdminClient.mockReturnValue(admin);
    const res = await updateDraftInvoice({
      request: post('/api/update-draft-invoice', {
        invoice_id: 'inv-1',
        remove_line_item_ids: [UUID_LINE_TIME, UUID_LINE_EXP, UUID_LINE_LEGACY],
      }),
      env: {},
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/void the invoice/i);
  });

  it('refuses edits that drop the total to zero', async () => {
    const zeroable = { ...DRAFT, invoice_line_items: [
      { id: UUID_LINE_TIME, time_entry_id: UUID_TIME, expense_id: null, item_type: 'time', amount: 500, sort_order: 0 },
      { id: UUID_LINE_LEGACY, time_entry_id: null, expense_id: null, item_type: 'time', amount: 0, sort_order: 1 },
    ] };
    const { admin } = draftAdmin({ invoice: zeroable });
    helpersMock.makeAdminClient.mockReturnValue(admin);
    const res = await updateDraftInvoice({
      request: post('/api/update-draft-invoice', { invoice_id: 'inv-1', remove_line_item_ids: [UUID_LINE_TIME] }), env: {},
    });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/greater than zero/i);
  });

  it('adding items appends lines (continuing sort_order), bills time entries and expenses', async () => {
    const { admin, ops } = draftAdmin({ invoice: DRAFT });
    helpersMock.makeAdminClient.mockReturnValue(admin);

    const res = await updateDraftInvoice({
      request: post('/api/update-draft-invoice', {
        invoice_id: 'inv-1',
        add_items: [
          { time_entry_id: UUID_TIME, description: 'Forgotten call', hours: 0.2, rate: 500, amount: 100, item_type: 'time' },
          { time_entry_id: 'fb_999',  description: 'FB pulled',      hours: 1,   rate: 175, amount: 175, item_type: 'time' },
          { expense_id: UUID_EXP,     description: 'Filing fee — Petition', amount: 350, item_type: 'expense' },
        ],
      }),
      env: {},
    });

    expect(res.status).toBe(200);
    expect(ops.insertedLines).toHaveLength(3);
    expect(ops.insertedLines[0].sort_order).toBe(3); // continues after existing 0..2
    expect(ops.insertedLines[1].time_entry_id).toBeNull(); // fb_ id never hits the uuid column
    expect(ops.insertedLines[1].external_entry_id).toBe('fb_999'); // …it lands here instead (1533)
    expect(ops.insertedLines[0].external_entry_id).toBeNull();     // portal uuid entries don't
    expect(ops.timeUpdates[0]).toMatchObject({ vals: { status: 'billed' }, ids: [UUID_TIME] });
    expect(ops.expenseUpdates[0].vals).toMatchObject({ billed: true, invoice_id: 'inv-1' });
  });

  it('header-only edits patch description/due_date without touching lines', async () => {
    const { admin, ops } = draftAdmin({ invoice: DRAFT });
    helpersMock.makeAdminClient.mockReturnValue(admin);
    const res = await updateDraftInvoice({
      request: post('/api/update-draft-invoice', { invoice_id: 'inv-1', description: 'June services', due_date: '2026-08-01' }), env: {},
    });
    expect(res.status).toBe(200);
    expect(ops.headerPatch).toEqual({ description: 'June services', due_date: '2026-08-01' });
    expect(ops.deletedLineIds).toBeNull();
    expect(ops.insertedLines).toBeNull();
  });
});

// ── FreshBooks send — must actually email the client ─────────────────────────

describe('FreshbooksAdapter.sendInvoiceWithPaymentLink', () => {
  function makeAdapter(existingNotes = '') {
    const a = new FreshbooksAdapter({ SUPABASE_URL: 'http://localhost', SUPABASE_SERVICE_KEY: 'x' });
    a._loadRow  = async () => {};
    a.accountId = 'acct_1';
    a._puts = [];
    a._put  = async (path, body) => { a._puts.push({ path, body }); return {}; };
    a._get  = async () => ({ response: { result: { invoice: { notes: existingNotes } } } });
    return a;
  }

  it('with a recipient: emails via action_email with the PDF attached and the pay link in notes', async () => {
    const a = makeAdapter();
    await a.sendInvoiceWithPaymentLink('fbinv-9', 'https://pay.example/x', 'client@example.com');
    const { path, body } = a._puts[0];
    expect(path).toMatch(/invoices\/invoices\/fbinv-9$/);
    expect(body.invoice).toMatchObject({
      action_email:      true,
      email_recipients:  ['client@example.com'],
      email_include_pdf: true,
      notes:             'Pay online: https://pay.example/x',
    });
    // action_email marks it sent itself — no bare status flip that skips the email
    expect(body.invoice.status).toBeUndefined();
  });

  it('without a recipient: falls back to mark-as-sent only (status 2)', async () => {
    const a = makeAdapter();
    await a.sendInvoiceWithPaymentLink('fbinv-9', 'https://pay.example/x', null);
    expect(a._puts[0].body.invoice).toMatchObject({ status: 2, notes: 'Pay online: https://pay.example/x' });
    expect(a._puts[0].body.invoice.action_email).toBeUndefined();
  });

  it('PRESERVES the notes Anita wrote on the FB invoice — pay link is appended, not a replacement', async () => {
    const a = makeAdapter('Thank you for your business.\nSee itemized time above.');
    await a.sendInvoiceWithPaymentLink('fbinv-9', 'https://pay.example/x', 'client@example.com');
    expect(a._puts[0].body.invoice.notes).toBe(
      'Thank you for your business.\nSee itemized time above.\n\nPay online: https://pay.example/x'
    );
  });

  it('on resend: replaces a previous "Pay online:" line instead of stacking stale links', async () => {
    const a = makeAdapter('Thank you for your business.\n\nPay online: https://pay.example/OLD');
    await a.sendInvoiceWithPaymentLink('fbinv-9', 'https://pay.example/NEW', 'client@example.com');
    const notes = a._puts[0].body.invoice.notes;
    expect(notes).toBe('Thank you for your business.\n\nPay online: https://pay.example/NEW');
    expect(notes).not.toContain('OLD');
  });

  it('still sends (link-only notes) when the notes read fails — never blocks the email', async () => {
    const a = makeAdapter();
    a._get = async () => { throw new Error('FB 500'); };
    await a.sendInvoiceWithPaymentLink('fbinv-9', 'https://pay.example/x', 'client@example.com');
    expect(a._puts[0].body.invoice.notes).toBe('Pay online: https://pay.example/x');
    expect(a._puts[0].body.invoice.action_email).toBe(true);
  });
});

// ── FreshBooks create — create_date is required by the real API ──────────────

describe('FreshbooksAdapter.createInvoice', () => {
  function makeAdapter() {
    const a = new FreshbooksAdapter({ SUPABASE_URL: 'http://localhost', SUPABASE_SERVICE_KEY: 'x' });
    a._loadRow  = async () => {};
    a.accountId = 'acct_1';
    a._findClientIdByEmail = async () => 777;
    a._posts = [];
    a._post  = async (path, body) => {
      a._posts.push({ path, body });
      return { response: { result: { invoice: { id: 42, invoice_number: 'FB-42' } } } };
    };
    return a;
  }
  const LINES  = [{ description: 'Work', hours: 1, rate: 100, amount: 100 }];
  const CLIENT = { email: 'client@example.com' };

  it('sends create_date from the portal invoice created_at (422 errno 1001 without it)', async () => {
    const a = makeAdapter();
    await a.createInvoice({ created_at: '2026-07-15 03:12:44+00', description: 'Legal Services' }, LINES, CLIENT);
    expect(a._posts[0].body.invoice.create_date).toBe('2026-07-15');
  });

  it('falls back to today (YYYY-MM-DD) when the invoice has no created_at', async () => {
    const a = makeAdapter();
    await a.createInvoice({ description: 'Legal Services' }, LINES, CLIENT);
    expect(a._posts[0].body.invoice.create_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('maps lines with FB\'s qty field (not quantity) and coerces Postgres numeric strings', async () => {
    const a = makeAdapter();
    // Postgres numerics arrive as strings — exactly what zeroed SSL invoice 0000013
    const lines = [
      { description: 'Test entry', hours: '0.10', rate: '500.00', amount: '50.00', item_type: 'time' },
      { description: 'Filing fee', hours: null,   rate: null,     amount: '75.00', item_type: 'expense' },
    ];
    await a.createInvoice({ created_at: '2026-07-15T00:00:00Z' }, lines, CLIENT);
    const fbLines = a._posts[0].body.invoice.lines;
    expect(fbLines[0].qty).toBe(0.1);            // numeric, from hours
    expect(fbLines[0].quantity).toBeUndefined(); // the field FB ignores
    expect(fbLines[0].unit_cost.amount).toBe('500.00');
    expect(fbLines[1].qty).toBe(1);              // expenses: qty 1 × amount
    expect(fbLines[1].unit_cost.amount).toBe('75.00');
  });
});
