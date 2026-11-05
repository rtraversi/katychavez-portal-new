// Estate Planning questionnaire: the definition, the validator that builds stored
// answers from it, the merge context, the token, and the public + staff endpoints.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { fakeDb } from '../support/ep-fake-db.js';

const helpersMock = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
  makeAdminClient: vi.fn(),
  verifyTurnstile: vi.fn(async () => true),
  json: (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}));
vi.mock('../../functions/api/_helpers.js', () => helpersMock);

import { NC_ESTATE_QUESTIONNAIRE as DEF, NC_COUNTIES } from '../../functions/api/_ep-questionnaire.js';
import { validateAnswers, isVisible } from '../../functions/api/_ep-validate.js';
import { buildEstateContext, BLANK, joinNames, longDate } from '../../functions/api/_ep-merge-context.js';
import { newToken, hashToken, looksLikeToken, requestStatus } from '../../functions/api/_ep-common.js';
import { onRequest as publicApi } from '../../functions/api/ep-intake-public.js';
import { onRequest as staffApi } from '../../functions/api/ep-intake-staff.js';

// ── The definition ───────────────────────────────────────────────────────────

function allFieldPaths(def) {
  const paths = new Set();
  for (const s of def.sections) for (const f of s.fields) paths.add(`${s.key}.${f.key}`);
  return paths;
}

describe('NC estate questionnaire definition', () => {
  it('has unique section keys and unique field keys per section and group', () => {
    const secKeys = DEF.sections.map(s => s.key);
    expect(new Set(secKeys).size).toBe(secKeys.length);
    for (const s of DEF.sections) {
      const keys = s.fields.map(f => f.key);
      expect(new Set(keys).size, s.key).toBe(keys.length);
      for (const g of s.fields.filter(f => f.type === 'group')) {
        const gk = g.fields.map(f => f.key);
        expect(new Set(gk).size, `${s.key}.${g.key}`).toBe(gk.length);
      }
    }
  });

  it('is fully bilingual — every label, hint, title and option has en and es', () => {
    const missing = [];
    const check = (o, where) => { if (o && (!o.en || !o.es)) missing.push(where); };
    check(DEF.title, 'title'); check(DEF.intro, 'intro');
    for (const s of DEF.sections) {
      check(s.title, `${s.key}.title`); if (s.lead) check(s.lead, `${s.key}.lead`);
      const walk = (fields, prefix) => fields.forEach(f => {
        check(f.label, `${prefix}.${f.key}`);
        if (f.hint) check(f.hint, `${prefix}.${f.key}.hint`);
        if (f.itemLabel) check(f.itemLabel, `${prefix}.${f.key}.itemLabel`);
        (f.options || []).forEach(o => check(o.label, `${prefix}.${f.key}=${o.value}`));
        if (f.fields) walk(f.fields, `${prefix}.${f.key}`);
      });
      walk(s.fields, s.key);
    }
    expect(missing).toEqual([]);
  });

  it('every showIf points at a real field and a real option value', () => {
    const paths = allFieldPaths(DEF);
    const fieldAt = (p) => { const [s, f] = p.split('.'); return DEF.sections.find(x => x.key === s)?.fields.find(x => x.key === f); };
    const bad = [];
    const checkCond = (cond, where, groupFields) => {
      for (const c of [].concat(cond || [])) {
        const target = c.f ? fieldAt(c.f) : groupFields?.find(x => x.key === c.row);
        if (!target || (c.f && !paths.has(c.f))) { bad.push(`${where}: unknown ${c.f || c.row}`); continue; }
        const values = [].concat(c.eq ?? [], c.ne ?? [], c.in ?? []);
        const opts = (target.options || []).map(o => o.value);
        for (const v of values) if (!opts.includes(v)) bad.push(`${where}: ${v} not an option of ${c.f || c.row}`);
      }
    };
    for (const s of DEF.sections) {
      checkCond(s.showIf, s.key);
      for (const f of s.fields) {
        checkCond(f.showIf, `${s.key}.${f.key}`);
        for (const rf of f.fields || []) checkCond(rf.showIf, `${s.key}.${f.key}.${rf.key}`, f.fields);
      }
    }
    expect(bad).toEqual([]);
  });

  it('lists all 100 North Carolina counties', () => {
    expect(NC_COUNTIES).toHaveLength(100);
    expect(new Set(NC_COUNTIES).size).toBe(100);
  });
});

// ── Validation ───────────────────────────────────────────────────────────────

const married = () => ({
  client: { full_legal_name: 'Maria Elena Lopez', county: 'Wake', email: 'maria@example.com', bogus: 'x' },
  marriage: { status: 'married', spouse_name: 'Jose Lopez' },
  children: { has_children: 'yes', list: [{ name: 'Ana Lopez', dob: '2015-03-02', parentage: 'ours' }, { name: '  ' }, {}] },
  distribution: { plan: 'spouse_then_children' },
  executors: { list: [{ name: 'Jose Lopez', relationship: 'spouse' }, { name: 'Rosa Diaz', relationship: 'sibling' }] },
  hacker: { anything: true },
});

describe('validateAnswers', () => {
  it('builds the payload from the definition — unknown sections and keys never survive', () => {
    const { answers } = validateAnswers(DEF, married(), 'draft');
    expect(answers.hacker).toBeUndefined();
    expect(answers.client.bogus).toBeUndefined();
    expect(answers.client.full_legal_name).toBe('Maria Elena Lopez');
  });

  it('drops blank group rows and invalid option values', () => {
    const input = married();
    input.marriage.status = 'complicated';
    input.children.list[0].parentage = 'aliens';
    const { answers } = validateAnswers(DEF, input, 'draft');
    expect(answers.marriage.status).toBeUndefined();
    expect(answers.children.list).toHaveLength(1);
    expect(answers.children.list[0].parentage).toBeUndefined();
  });

  it('rejects malformed dates and caps long text', () => {
    const { answers } = validateAnswers(DEF, { client: { dob: '03/02/1980', other_names: 'x'.repeat(1000) } }, 'draft');
    expect(answers.client.dob).toBeUndefined();
    expect(answers.client.other_names).toHaveLength(300);
  });

  it('draft keeps answers in hidden sections; submit drops them', () => {
    const input = married();
    input.marriage.status = 'single';            // spouse fields now hidden
    input.children.has_children = 'no';          // guardians section + list hidden
    input.guardians = { needed: 'yes', list: [{ name: 'Someone' }] };
    const draft = validateAnswers(DEF, input, 'draft').answers;
    expect(draft.marriage.spouse_name).toBe('Jose Lopez');
    expect(draft.guardians.list).toHaveLength(1);

    const sub = validateAnswers(DEF, input, 'submit').answers;
    expect(sub.marriage.spouse_name).toBeUndefined();
    expect(sub.guardians).toBeUndefined();
    expect(sub.children.list).toBeUndefined();
  });

  it('enforces required fields only on submit, only where visible', () => {
    expect(validateAnswers(DEF, {}, 'draft').errors).toEqual([]);
    const { errors } = validateAnswers(DEF, {}, 'submit');
    const fields = errors.map(e => `${e.section}.${e.field}`);
    expect(fields).toEqual(expect.arrayContaining(['client.full_legal_name', 'marriage.status', 'children.has_children', 'distribution.plan']));
    // guardians.* is hidden without children, so nothing there is required
    expect(fields.some(f => f.startsWith('guardians'))).toBe(false);
  });

  it('requires a name on each group row that has other content', () => {
    const input = married();
    input.executors.list.push({ phone: '555-0100' });
    const { errors } = validateAnswers(DEF, input, 'submit');
    expect(errors.map(e => e.field)).toContain('list.2.name');
  });

  it('flags a malformed email on submit', () => {
    const input = married();
    input.client.email = 'not-an-email';
    const { errors } = validateAnswers(DEF, input, 'submit');
    expect(errors.map(e => e.field)).toContain('email');
  });

  it('isVisible handles eq / in / row conditions and arrays', () => {
    const a = { marriage: { status: 'married' } };
    expect(isVisible({ f: 'marriage.status', in: ['married', 'separated'] }, a)).toBe(true);
    expect(isVisible({ f: 'marriage.status', eq: 'single' }, a)).toBe(false);
    expect(isVisible({ row: 'relationship', eq: 'other' }, a, { relationship: 'other' })).toBe(true);
    expect(isVisible([{ f: 'marriage.status', eq: 'married' }, { f: 'x.y', eq: 1 }], a)).toBe(false);
  });
});

// ── Merge context ────────────────────────────────────────────────────────────

describe('buildEstateContext', () => {
  const answers = () => validateAnswers(DEF, {
    ...married(),
    client: { full_legal_name: 'Maria Elena Lopez', county: 'Wake', address: '1 Main St\nRaleigh, NC 27601', dob: '1980-03-02' },
    health: {
      hcpoa_wanted: 'yes',
      agents: [{ name: 'Jose Lopez', relationship: 'spouse', address: '1 Main St' }, { name: 'Rosa Diaz', relationship: 'sibling', phone: '919-555-0100' }],
      hipaa_people: [{ name: 'Jose Lopez', relationship: 'spouse' }, { name: 'Dr. Friend', relationship: 'other' }],
    },
  }, 'submit').answers;

  it('fills the principal from the answers, with NC county wording', () => {
    const ctx = buildEstateContext({ answers: answers(), now: new Date('2026-11-04T12:00:00Z') });
    expect(ctx.principal_name).toBe('Maria Elena Lopez');
    expect(ctx.principal_name_upper).toBe('MARIA ELENA LOPEZ');
    expect(ctx.principal_dob_long).toBe('March 2, 1980');
    expect(ctx.principal_address_inline).toBe('1 Main St, Raleigh, NC 27601');
    expect(ctx.principal_county_line).toBe('Wake County, North Carolina');
    expect(ctx.today_long).toBe('November 4, 2026');
    expect(ctx.hc_agent_1_name).toBe('Jose Lopez');
    expect(ctx.hc_agent_2_relationship).toBe('my sibling');
    expect(ctx.has_hc_agent_2).toBe(true);
    expect(ctx.has_hc_agent_3).toBe(false);
    expect(ctx.hc_agent_3_name).toBe(BLANK);
    expect(ctx.children_list).toBe('Ana Lopez');
  });

  it('role spouse swaps the principal, and "my spouse" rows become the client', () => {
    const ctx = buildEstateContext({ answers: answers(), role: 'spouse' });
    expect(ctx.principal_name).toBe('Jose Lopez');
    expect(ctx.spouse_name).toBe('Maria Elena Lopez');
    expect(ctx.hc_agent_1_name).toBe('Maria Elena Lopez');     // the client, not Jose naming himself
    expect(ctx.executor_1_name).toBe('Maria Elena Lopez');
    expect(ctx.executor_2_name).toBe('Rosa Diaz');
    expect(ctx.hipaa_people_list.split('\n')[0]).toBe('Maria Elena Lopez (my spouse)');
    expect(ctx.principal_county_line).toBe('Wake County, North Carolina');   // same household
  });

  it('renders visible blanks, never empty strings, when answers are missing', () => {
    const ctx = buildEstateContext({ answers: {} });
    for (const k of ['principal_name', 'principal_county_line', 'poa_agent_1_name', 'hipaa_people_list', 'children_list', 'spouse_name']) {
      expect(ctx[k], k).toBe(BLANK);
    }
    expect(ctx.has_spouse).toBe(false);
    expect(ctx.has_children).toBe(false);
  });

  it('falls back to the client record when the questionnaire left the name blank', () => {
    const ctx = buildEstateContext({ answers: {}, client: { first_name: 'Ana', last_name: 'Ruiz', email: 'a@x.com' } });
    expect(ctx.principal_name).toBe('Ana Ruiz');
    expect(ctx.principal_email).toBe('a@x.com');
  });

  it('a client outside NC gets no county line', () => {
    const ctx = buildEstateContext({ answers: { client: { full_legal_name: 'X', county: 'outside_nc' } } });
    expect(ctx.principal_county_line).toBe(BLANK);
  });

  it('helpers', () => {
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B and C');
    expect(joinNames([])).toBe(BLANK);
    expect(longDate('nope')).toBe(BLANK);
  });
});

// ── Tokens ───────────────────────────────────────────────────────────────────

describe('tokens', () => {
  it('are 256-bit base64url and hash to stable hex', async () => {
    const t = newToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(looksLikeToken(t)).toBe(true);
    expect(looksLikeToken('short')).toBe(false);
    const h = await hashToken(t);
    expect(h).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashToken(t)).toBe(h);
  });

  it('requestStatus', () => {
    const future = new Date(Date.now() + 86400000).toISOString();
    expect(requestStatus(null)).toBe('invalid');
    expect(requestStatus({ expires_at: future })).toBe('open');
    expect(requestStatus({ expires_at: future, revoked_at: 'x' })).toBe('revoked');
    expect(requestStatus({ expires_at: '2000-01-01' })).toBe('expired');
    expect(requestStatus({ expires_at: '2000-01-01', submitted_at: 'x' })).toBe('submitted');
  });
});

// ── Endpoints ────────────────────────────────────────────────────────────────

const ENV = { PORTAL_FIRM_NAME: 'Test Law', PORTAL_URL: 'https://portal.test' };
const future = () => new Date(Date.now() + 30 * 86400000).toISOString();

async function seedOpen(db, extra = {}) {
  const token = newToken();
  db.tables.ep_intake_requests.push({
    id: 'req-1', matter_id: 'm-1', questionnaire_key: 'nc_estate', questionnaire_version: 1,
    token_hash: await hashToken(token), language: 'es', expires_at: future(), revoked_at: null,
    submitted_at: null, opened_at: null, draft_answers: { client: { full_legal_name: 'Maria' } }, sent_by: 'u-1', ...extra,
  });
  return token;
}

function freshDb() {
  return fakeDb({
    ep_intake_requests: [],
    matters: [{ id: 'm-1', assigned_attorney_id: 'u-2', client: { first_name: 'Maria', last_name: 'Lopez', email: 'maria@example.com' } }],
    users: [{ id: 'u-1', email: 'para@firm.test', active: true }, { id: 'u-2', email: 'atty@firm.test', active: true }],
  });
}

const post = (path, body) => new Request(`http://portal.test${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});
const get = (path) => new Request(`http://portal.test${path}`);

describe('public endpoints', () => {
  let db;
  beforeEach(() => {
    vi.clearAllMocks();
    db = freshDb();
    helpersMock.makeAdminClient.mockReturnValue(db);
    helpersMock.verifyTurnstile.mockResolvedValue(true);
  });

  it('load: an unknown token is invalid and reveals nothing', async () => {
    const res = await publicApi({ request: get('/api/ep-intake/public-load?t=' + newToken()), env: ENV });
    const body = await res.json();
    expect(body.status).toBe('invalid');
    expect(body.definition).toBeUndefined();
    expect(body.answers).toBeUndefined();
  });

  it('load: an open link returns the definition, saved progress, first name — not the matter id', async () => {
    const token = await seedOpen(db);
    const res = await publicApi({ request: get('/api/ep-intake/public-load?t=' + token), env: ENV });
    const body = await res.json();
    expect(body.status).toBe('open');
    expect(body.first_name).toBe('Maria');
    expect(body.language).toBe('es');
    expect(body.definition.key).toBe('nc_estate');
    expect(body.answers.client.full_legal_name).toBe('Maria');
    expect(JSON.stringify(body)).not.toContain('m-1');
    expect(db.tables.ep_intake_requests[0].opened_at).toBeTruthy();
  });

  it('load: preview needs no token and saves nothing', async () => {
    const res = await publicApi({ request: get('/api/ep-intake/public-load?preview=1&lang=es'), env: ENV });
    const body = await res.json();
    expect(body.status).toBe('preview');
    expect(body.language).toBe('es');
    expect(body.definition.sections.length).toBeGreaterThan(5);
  });

  it('save: stores sanitised draft answers', async () => {
    const token = await seedOpen(db);
    const res = await publicApi({ request: post('/api/ep-intake/public-save', { t: token, lang: 'en', answers: { client: { full_legal_name: 'Maria L', x: 1 }, junk: {} } }), env: ENV });
    expect(res.status).toBe(200);
    const row = db.tables.ep_intake_requests[0];
    expect(row.draft_answers).toEqual({ client: { full_legal_name: 'Maria L' } });
    expect(row.language).toBe('en');
  });

  it('save: refuses a revoked link', async () => {
    const token = await seedOpen(db, { revoked_at: new Date().toISOString() });
    const res = await publicApi({ request: post('/api/ep-intake/public-save', { t: token, answers: {} }), env: ENV });
    expect(res.status).toBe(410);
  });

  it('submit: 422 with the missing required answers', async () => {
    const token = await seedOpen(db);
    const res = await publicApi({ request: post('/api/ep-intake/public-submit', { t: token, answers: { client: {} } }), env: ENV });
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.errors.length).toBeGreaterThan(0);
    expect(db.tables.ep_intake_requests[0].submitted_at).toBeNull();
  });

  it('submit: blocked when Turnstile fails', async () => {
    helpersMock.verifyTurnstile.mockResolvedValue(false);
    const token = await seedOpen(db);
    const res = await publicApi({ request: post('/api/ep-intake/public-submit', { t: token, answers: married() }), env: ENV });
    expect(res.status).toBe(403);
  });

  it('submit: freezes the submitted answers, then refuses a second submit', async () => {
    const token = await seedOpen(db);
    const res = await publicApi({ request: post('/api/ep-intake/public-submit', { t: token, answers: married() }), env: ENV });
    expect(res.status).toBe(200);
    const row = db.tables.ep_intake_requests[0];
    expect(row.submitted_at).toBeTruthy();
    expect(row.answers_submitted).toEqual(row.answers);
    expect(row.answers.client.full_legal_name).toBe('Maria Elena Lopez');
    expect(row.answers.hacker).toBeUndefined();

    const again = await publicApi({ request: post('/api/ep-intake/public-submit', { t: token, answers: married() }), env: ENV });
    expect(again.status).toBe(409);
  });
});

describe('staff endpoints', () => {
  let db;
  beforeEach(() => {
    vi.clearAllMocks();
    db = freshDb();
    helpersMock.makeAdminClient.mockReturnValue(db);
    helpersMock.verifyAuth.mockResolvedValue({ profile: { id: 'u-1', roles: { name: 'Paralegal' } }, accessLevel: 'write', isClient: false });
  });

  it('send: refuses a Client even if a role grant would let them through', async () => {
    helpersMock.verifyAuth.mockResolvedValue({ profile: { id: 'c', roles: { name: 'Client' } }, accessLevel: 'write', isClient: true });
    const res = await staffApi({ request: post('/api/ep-intake/send', { matter_id: 'm-1' }), env: ENV });
    expect(res.status).toBe(403);
  });

  it('send: creates a link whose token is stored only as a hash', async () => {
    const res = await staffApi({ request: post('/api/ep-intake/send', { matter_id: 'm-1', language: 'es' }), env: ENV });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.link).toMatch(/^https:\/\/portal\.test\/estate-intake\?t=[A-Za-z0-9_-]{43}$/);
    const row = db.tables.ep_intake_requests[0];
    const token = new URL(body.link).searchParams.get('t');
    expect(row.token_hash).toBe(await hashToken(token));
    expect(JSON.stringify(row)).not.toContain(token);
    expect(row.language).toBe('es');
    expect(row.sent_to_email).toBe('maria@example.com');
  });

  it('send: a resend revokes the open link and carries its progress forward', async () => {
    await seedOpen(db);
    const res = await staffApi({ request: post('/api/ep-intake/send', { matter_id: 'm-1' }), env: ENV });
    expect(res.status).toBe(200);
    expect((await res.json()).carried_progress).toBe(true);
    const [old, fresh] = db.tables.ep_intake_requests;
    expect(old.revoked_at).toBeTruthy();
    expect(fresh.draft_answers).toEqual({ client: { full_legal_name: 'Maria' } });
  });

  it('send: without an email it can still create a link to copy', async () => {
    db.tables.matters[0].client.email = null;
    const refused = await staffApi({ request: post('/api/ep-intake/send', { matter_id: 'm-1' }), env: ENV });
    expect(refused.status).toBe(400);
    const ok = await staffApi({ request: post('/api/ep-intake/send', { matter_id: 'm-1', send_email: false }), env: ENV });
    expect(ok.status).toBe(200);
    expect(db.tables.ep_intake_requests[0].sent_to_email).toBeNull();
  });

  it('answers: staff edits are validated and never touch the original submission', async () => {
    await seedOpen(db, { submitted_at: new Date().toISOString(), answers: { client: { full_legal_name: 'Maria' } }, answers_submitted: { client: { full_legal_name: 'Maria' } } });
    const res = await staffApi({ request: post('/api/ep-intake/answers', { request_id: 'req-1', answers: { client: { full_legal_name: 'María Elena López', evil: 1 } } }), env: ENV });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.warnings.length).toBeGreaterThan(0);     // still-blank required answers are warnings
    const row = db.tables.ep_intake_requests[0];
    expect(row.answers).toEqual({ client: { full_legal_name: 'María Elena López' } });
    expect(row.answers_submitted).toEqual({ client: { full_legal_name: 'Maria' } });
    expect(row.answers_updated_by).toBe('u-1');
  });

  it('answers: an unsubmitted questionnaire cannot be edited by staff', async () => {
    await seedOpen(db);
    const res = await staffApi({ request: post('/api/ep-intake/answers', { request_id: 'req-1', answers: {} }), env: ENV });
    expect(res.status).toBe(409);
  });

  it('enter: staff answers become a submitted questionnaire no link can open', async () => {
    const res = await staffApi({ request: post('/api/ep-intake/enter', { matter_id: 'm-1', answers: married() }), env: ENV });
    expect(res.status).toBe(200);
    const row = db.tables.ep_intake_requests[0];
    expect(row.submitted_at).toBeTruthy();
    expect(row.answers.client.full_legal_name).toBe('Maria Elena Lopez');
    expect(row.answers_submitted).toEqual(row.answers);
    expect(row.answers.hacker).toBeUndefined();
    expect(row.sent_by).toBe('u-1');
    expect(row.token_hash).toMatch(/^staff:[0-9a-f]{32}$/);

    const view = await (await staffApi({ request: get('/api/ep-intake/matter?matter_id=m-1'), env: ENV })).json();
    expect(view.requests[0]).toMatchObject({ status: 'submitted', entered_by_staff: true });
    expect(view.requests[0].token_hash).toBeUndefined();
  });

  it('enter: partial answers save with warnings, and close the client’s open link', async () => {
    await seedOpen(db);
    const res = await staffApi({ request: post('/api/ep-intake/enter', { matter_id: 'm-1', answers: { client: { full_legal_name: 'Maria' } } }), env: ENV });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.warnings.length).toBeGreaterThan(0);
    expect(body.closed_link).toBe(true);
    const [open, entered] = db.tables.ep_intake_requests;
    expect(open.revoked_at).toBeTruthy();
    expect(entered.submitted_at).toBeTruthy();
  });

  it('enter: a Client cannot use it', async () => {
    helpersMock.verifyAuth.mockResolvedValue({ profile: { id: 'c', roles: { name: 'Client' } }, accessLevel: 'write', isClient: true });
    const res = await staffApi({ request: post('/api/ep-intake/enter', { matter_id: 'm-1', answers: married() }), env: ENV });
    expect(res.status).toBe(403);
    expect(db.tables.ep_intake_requests).toHaveLength(0);
  });

  it('matter: lists requests with status and never the token hash', async () => {
    await seedOpen(db);
    const res = await staffApi({ request: get('/api/ep-intake/matter?matter_id=m-1'), env: ENV });
    const body = await res.json();
    expect(body.requests[0].status).toBe('open');
    expect(body.requests[0].token_hash).toBeUndefined();
    expect(body.definitions.nc_estate).toBeTruthy();
  });
});
