// Estate Planning drafting: starter install, and filling a real template from
// submitted answers into draft_documents (the same rows/keys drafting-generate uses).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PizZip from 'pizzip';
import { fakeDb, fakeR2 } from '../support/ep-fake-db.js';

const helpersMock = vi.hoisted(() => ({
  verifyAuth: vi.fn(),
  makeAdminClient: vi.fn(),
  json: (status, body) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } }),
}));
vi.mock('../../functions/api/_helpers.js', () => helpersMock);
vi.mock('../../functions/api/webdav.js', () => ({ generateWebDAVToken: async () => 'tok' }));

import { onRequest as draftApi } from '../../functions/api/ep-draft.js';
import { PLAN_TEMPLATES } from '../../functions/api/_ep-plan-templates.js';
import { STARTER_TEMPLATES } from '../../functions/api/_ep-starter-templates.js';
import { contextKeys } from '../../functions/api/_ep-merge-context.js';

const ENV_BASE = { PORTAL_FIRM_NAME: 'Test Law' };
const post = (path, body) => new Request(`http://portal.test${path}`, {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

const b64 = (s) => Uint8Array.from(atob(s), c => c.charCodeAt(0));
function docText(bytes) {
  const xml = new PizZip(bytes).file('word/document.xml').asText();
  return xml.replace(/<\/w:p>/g, '\n').replace(/<[^>]+>/g, '').replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
}

const ANSWERS = {
  client: { full_legal_name: 'Maria Elena Lopez', county: 'Durham', address: '12 Oak Lane\nDurham, NC 27701' },
  marriage: { status: 'married', spouse_name: 'Jose Lopez' },
  children: { has_children: 'yes', list: [{ name: 'Ana Lopez' }] },
  executors: { list: [{ name: 'Jose Lopez', relationship: 'spouse', city_state: 'Durham, NC' }, { name: 'Rosa Diaz', relationship: 'sibling' }] },
};

describe('bundled templates', () => {
  it('use only tags from the merge contract', () => {
    const allowed = contextKeys();
    for (const t of [...PLAN_TEMPLATES, ...STARTER_TEMPLATES]) {
      const text = docText(b64(t.base64));
      const tags = [...text.matchAll(/\{\{\s*[#^/]?\s*([A-Za-z0-9_]+)\s*\}\}/g)].map(m => m[1]);
      expect(tags.filter(x => !allowed.has(x)), t.key).toEqual([]);
    }
  });

  it('have unique keys', () => {
    const keys = [...PLAN_TEMPLATES, ...STARTER_TEMPLATES].map(t => t.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe('/api/ep-intake/install-starters and /draft', () => {
  let db, r2, env;
  beforeEach(() => {
    vi.clearAllMocks();
    db = fakeDb({
      draft_templates: [], draft_documents: [], draft_document_versions: [],
      matters: [{ id: 'm-1', assigned_attorney_id: 'u-9', client: { first_name: 'Maria', last_name: 'Lopez' } }],
      users: [{ id: 'u-9', first_name: 'Katy', last_name: 'Chavez' }],
      ep_intake_requests: [{ id: 'req-1', matter_id: 'm-1', submitted_at: '2026-11-01T00:00:00Z', answers: ANSWERS }],
    });
    r2 = fakeR2();
    env = { ...ENV_BASE, R2: r2 };
    helpersMock.makeAdminClient.mockReturnValue(db);
    helpersMock.verifyAuth.mockResolvedValue({ profile: { id: 'u-1', first_name: 'Pat', last_name: 'Ng', roles: { name: 'Paralegal' } }, accessLevel: 'write', isClient: false });
  });

  async function install() {
    const res = await draftApi({ request: post('/api/ep-intake/install-starters', {}), env });
    expect(res.status).toBe(200);
    return res.json();
  }

  it('installs every starter once, scoped to estate case types, and is idempotent', async () => {
    await install();
    const n = PLAN_TEMPLATES.length + STARTER_TEMPLATES.length;
    expect(db.tables.draft_templates).toHaveLength(n);
    for (const t of db.tables.draft_templates) {
      expect(t.merge_profile).toBe('estate_planning');
      expect(t.case_types).toContain('simple_will');
      expect(r2.store.has(t.template_docx_r2_key)).toBe(true);
    }
    const again = await install();
    expect(again.results.every(r => r.status === 'already_installed')).toBe(true);
    expect(db.tables.draft_templates).toHaveLength(n);
  });

  it('drafts the will from the latest submitted answers, into draft_documents', async () => {
    await install();
    const will = db.tables.draft_templates.find(t => t.starter_key === 'nc_pour_over_will');
    const res = await draftApi({ request: post('/api/ep-intake/draft', { matter_id: 'm-1', template_ids: [will.id] }), env });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.created).toHaveLength(1);
    expect(body.created[0].word_url).toMatch(/^ms-word:ofe\|u\|http:\/\/portal\.test\/webdav\/tok\//);
    expect(body.created[0].file_name).toMatch(/^\d{4}-\d{2}-\d{2} PN NC Pour-Over Will - Maria Elena Lopez\.docx$/);

    const doc = db.tables.draft_documents[0];
    expect(doc.ep_role).toBe('client');
    expect(doc.wizard_data).toEqual({ ep_request_id: 'req-1', role: 'client' });
    const text = docText(r2.store.get(`drafts/m-1/${doc.id}/v1.docx`));
    expect(text).toContain('LAST WILL AND TESTAMENT OF MARIA ELENA LOPEZ');
    expect(text).toContain('a resident of Durham County, North Carolina');
    expect(text).toContain('I am married to Jose Lopez');
    expect(text).toContain('I nominate Jose Lopez, of Durham, NC, as Executor');
    expect(text).toContain('[30]');                 // attorney choices stay bracketed
    expect(text).not.toContain('{{');
    expect(db.tables.draft_document_versions[0]).toMatchObject({ document_id: doc.id, version_num: 1 });
  });

  it('drafts the reciprocal will for the spouse', async () => {
    await install();
    const will = db.tables.draft_templates.find(t => t.starter_key === 'nc_pour_over_will');
    const res = await draftApi({ request: post('/api/ep-intake/draft', { matter_id: 'm-1', template_ids: [will.id], role: 'spouse' }), env });
    expect(res.status).toBe(200);
    const doc = db.tables.draft_documents[0];
    const text = docText(r2.store.get(`drafts/m-1/${doc.id}/v1.docx`));
    expect(text).toContain('LAST WILL AND TESTAMENT OF JOSE LOPEZ');
    expect(text).toContain('I am married to Maria Elena Lopez');
    expect(text).toContain('I nominate Maria Elena Lopez');
  });

  it('refuses without a submitted questionnaire, and refuses a non-estate template', async () => {
    db.tables.ep_intake_requests[0].submitted_at = null;
    await install();
    const id = db.tables.draft_templates[0].id;
    const none = await draftApi({ request: post('/api/ep-intake/draft', { matter_id: 'm-1', template_ids: [id] }), env });
    expect(none.status).toBe(409);

    db.tables.ep_intake_requests[0].submitted_at = '2026-11-01T00:00:00Z';
    db.tables.draft_templates.push({ id: 'fam-1', name: 'Petition', merge_profile: null, active: true, template_docx_r2_key: 'x' });
    const wrong = await draftApi({ request: post('/api/ep-intake/draft', { matter_id: 'm-1', template_ids: ['fam-1'] }), env });
    expect(wrong.status).toBe(422);
    expect((await wrong.json()).failed[0].error).toMatch(/Not an estate-planning template/);
  });

  it('a spouse draft needs a spouse', async () => {
    db.tables.ep_intake_requests[0].answers = { client: { full_legal_name: 'Solo' }, marriage: { status: 'single' } };
    await install();
    const res = await draftApi({ request: post('/api/ep-intake/draft', { matter_id: 'm-1', template_ids: [db.tables.draft_templates[0].id], role: 'spouse' }), env });
    expect(res.status).toBe(400);
  });
});
