// Proof Scan v2, the page (Batch 5): pages/proof-scan-v2/.
//
// These drive the REAL page modules through a DOM stand-in, wired to the REAL
// v2 route handlers and the real server engine against an in-memory database.
// Only sign-in and the AI are stood in: the model answers come from the
// preview's synthetic scenarios (test/fixtures/proof-scan-v2/scenarios.mjs).
// What they hold:
//
//   * every result block is drawn from the result the server STORED (D-18)
//   * text only: hostile strings from files, the AI or the server stay text (D-41)
//   * size limits are enforced in the browser before anything is sent (D-95)
//   * the full SSN is fetched only when the eye is pressed (D-80)
//   * DACA is gated by the evidence requirement; General is not (D-91, D-95)
//   * a new run clears the stage's sign-off (D-75)
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({ verifyAuth: vi.fn(), makeAdminClient: vi.fn() }));
vi.mock('../../functions/api/_helpers.js', async (importOriginal) => ({
  ...(await importOriginal()),
  verifyAuth: helpersMock.verifyAuth,
  makeAdminClient: helpersMock.makeAdminClient,
}));

import { onRequest as caseRoute } from '../../functions/api/proof-scan-v2-case.js';
import { onRequest as casesRoute } from '../../functions/api/proof-scan-v2-cases.js';
import { onRequest as personRoute } from '../../functions/api/proof-scan-v2-person.js';
import { onRequest as suggestionRoute } from '../../functions/api/proof-scan-v2-suggestion.js';
import { onRequest as ssnRoute } from '../../functions/api/proof-scan-v2-ssn.js';
import { onRequest as evidenceRoute } from '../../functions/api/proof-scan-v2-evidence.js';
import { onRequest as runRoute } from '../../functions/api/proof-scan-v2-run.js';
import { onRequest as signoffRoute } from '../../functions/api/proof-scan-v2-signoff.js';
import { onRequest as rulesRoute } from '../../functions/api/proof-scan-v2-rules.js';
import { onRequest as suppressionsRoute } from '../../functions/api/proof-scan-v2-suppressions.js';
import { onRequest as possibleIssueRoute } from '../../functions/api/proof-scan-v2-possible-issue.js';

import { mountProofScanV2 } from '../../pages/proof-scan-v2/app.js';
import { createApi } from '../../pages/proof-scan-v2/api.js';
import { renderReviewResult, renderPhysicalScanResult } from '../../pages/proof-scan-v2/results.js';
import { renderPossibleIssues } from '../../pages/proof-scan-v2/possible-issues.js';
import {
  checkFiles, LIMITS, reviewModel, physicalScanReport, stepState, mediaTypeOf,
} from '../../pages/proof-scan-v2/model.js';
import { modelAnswer } from '../fixtures/proof-scan-v2/scenarios.mjs';
import { seededDb, ENV, STAFF } from '../support/proof-scan-v2-harness.js';
import {
  fakeV2Document, byClass, oneByClass, byTag, textOf, click, flush, change, fakeFile, findAll,
} from '../support/fake-dom-v2.js';

const ROUTES = {
  '/api/proof-scan-v2-case': caseRoute, '/api/proof-scan-v2-cases': casesRoute, '/api/proof-scan-v2-person': personRoute,
  '/api/proof-scan-v2-suggestion': suggestionRoute, '/api/proof-scan-v2-ssn': ssnRoute, '/api/proof-scan-v2-evidence': evidenceRoute,
  '/api/proof-scan-v2-run': runRoute, '/api/proof-scan-v2-signoff': signoffRoute, '/api/proof-scan-v2-rules': rulesRoute,
  '/api/proof-scan-v2-suppressions': suppressionsRoute, '/api/proof-scan-v2-possible-issue': possibleIssueRoute,
};

// The page's own API client, with fetch going straight to the route handlers.
const routedFetch = async (url, opts) => {
  const u = new URL(url, 'http://portal.test');
  const handler = ROUTES[u.pathname];
  if (!handler) throw new Error(`no route ${u.pathname}`);
  return handler({ request: new Request(u, opts), env: ENV });
};

let db;
let api;
let priorDoc;
let priorMatch;

beforeEach(() => {
  vi.clearAllMocks();
  db = seededDb();
  helpersMock.makeAdminClient.mockReturnValue(db);
  helpersMock.verifyAuth.mockResolvedValue(STAFF);
  // The model: synthetic observations from the preview scenarios.
  globalThis.fetch = vi.fn(async (url, opts) => {
    if (!String(url).startsWith('https://api.anthropic.com/')) return new Response('{}', { status: 200 });
    return new Response(JSON.stringify({
      model: 'test', stop_reason: 'end_turn', usage: {},
      content: [{ type: 'text', text: JSON.stringify(modelAnswer(JSON.parse(opts.body))) }],
    }), { status: 200 });
  });
  api = createApi({ fetchImpl: routedFetch, getToken: async () => 't' });
  for (const k of Object.keys(api)) api[k] = vi.fn(api[k]);
  priorDoc = globalThis.document;
  priorMatch = globalThis.matchMedia;
  globalThis.document = fakeV2Document();
  globalThis.matchMedia = () => ({ matches: true });
});

afterEach(() => {
  globalThis.document = priorDoc;
  globalThis.matchMedia = priorMatch;
});

// ── Driving the page ─────────────────────────────────────────────────────────

async function mount() {
  const root = document.createElement('div');
  mountProofScanV2({ root, api });
  await flush();
  return root;
}

// A finding is drawn as a bold sentence and a plain one; read it as one line.
const flatText = (n) => textOf(n).replace(/\n(?= )/g, '');
const buttonByText = (root, text) => findAll(root, (n) => n.tagName === 'button' && String(n.textContent).includes(text))[0];
const stepOf = (root, stage) => findAll(root, (n) => /\bv2-step\b/.test(n.className) && n.dataset.stage === stage)[0];
const stepButton = (root, stage) => byTag(stepOf(root, stage), 'button')[0];

async function startCase(root, caseType, label) {
  const sel = findAll(root, (n) => n.id === 'ps2-case-type')[0];
  await change(sel, caseType);
  const name = findAll(root, (n) => n.id === 'ps2-case-label')[0];
  name.value = label;
  await name.dispatchEvent({ type: 'input', target: name });
  await click(oneByClass(root, 'v2-start-btn'));
  await flush();
}

async function pickFiles(root, files, nth = 0) {
  const input = byClass(root, 'v2-file-input')[nth];
  input.files = files;
  await change(input);
  await flush();
}

async function openStage(root, stage) {
  await click(stepButton(root, stage));
  await flush();
}

async function runStage(root, files) {
  await pickFiles(root, files);
  await click(oneByClass(root, 'ps-scan-btn'));
  await flush();
}

// A DACA case through Evidence Zero, ready for the stages.
async function readyDacaCase(root) {
  await startCase(root, 'daca_renewal', 'Rivera, Ana');
  await pickFiles(root, [fakeFile('ead-ana-rivera.pdf'), fakeFile('intake-ana-rivera.pdf')]);
  await click(oneByClass(root, 'v2-approve'));
  await flush();
}

// ── Rendering from stored results ────────────────────────────────────────────

describe('stored results drive every block', () => {
  it('Draft Review: our errors, evidence vs forms, checklist groups, needs info, please confirm, later, not checked, Possible issues', async () => {
    const root = await mount();
    await readyDacaCase(root);
    await openStage(root, 'draft_review');
    await runStage(root, [fakeFile('daca-drafts.pdf')]);

    const stored = db.rows('proof_scans').at(-1).result_json;
    const card = oneByClass(root, 'v2-result');
    expect(oneByClass(card, 'psr-verdict').textContent).toBe(stored.primary_report_language);
    expect(stored.attention_count).toBe(3);

    // Our errors: the consistency check and the difference from the case card.
    const our = oneByClass(card, 'v2-our-errors');
    expect(oneByClass(our, 'psr-count').textContent).toBe('2');
    expect(flatText(our)).toContain('The I-765 shows A-Number A-123456798. The case card has A-123456789.');
    // D-98: evidence against the forms.
    const match = oneByClass(card, 'v2-match');
    expect(textOf(match)).toContain("The applicant's EAD");
    expect(byClass(match, 'v2-match-row--bad')).toHaveLength(1);
    // Checklist: the missing form, then one fold per form.
    const checklist = oneByClass(card, 'v2-checklist');
    expect(textOf(checklist)).toContain('The I-765WS is missing from the package.');
    expect(byClass(checklist, 'psr-fold-form').map((n) => n.textContent)).toEqual(expect.arrayContaining(['G-1450', 'G-28', 'I-821D', 'I-765']));
    // Never counted: needs info and please confirm (D-47, D-70).
    expect(textOf(oneByClass(card, 'v2-needs-info'))).toContain('Verify if EAD home or office');
    expect(textOf(oneByClass(card, 'v2-confirm'))).toContain('Read/Understand English (YES)');
    expect(textOf(oneByClass(card, 'v2-later'))).toContain('Required signatures are present.');
    expect(textOf(oneByClass(card, 'v2-not-checked'))).toContain('Page 11 of the I-821D is too faint');
    // Possible issues: violet section, its own count, not the attention count.
    const pi = oneByClass(card, 'ps-explore');
    expect(oneByClass(pi, 'ps-explore-count').textContent).toBe('1');
    expect(textOf(pi)).toContain('Phone number written two ways');
    // Every attention item the server stored is drawn as a finding.
    const findings = byClass(card, 'psr-notice--needs_attention').map((n) => textOf(n)).join('\n');
    for (const a of stored.attention) expect(findings).toContain(a.title.split('. ')[0]);
  });

  it('Pre-flight: client corrections from the uploaded markups and corrected pages', async () => {
    const root = await mount();
    await readyDacaCase(root);
    await openStage(root, 'preflight');
    await pickFiles(root, [fakeFile('corrected-forms.pdf')]);
    // In the corrections zone the corrected-pages picker sits in the button row,
    // before the zone's own (marked-up pages) input.
    await pickFiles(root, [fakeFile('client-markups.pdf')], 2);
    await pickFiles(root, [fakeFile('corrected-pages.pdf')], 1);
    await click(oneByClass(root, 'ps-scan-btn'));
    await flush();

    const sent = JSON.parse(globalThis.fetch.mock.calls.at(-1)[1].body);
    expect(sent.messages[0].content.filter((b) => b.type === 'text').map((b) => b.text))
      .toEqual(expect.arrayContaining(['File 2: client-markups.pdf (marked)', 'File 3: corrected-pages.pdf (corrected)']));
    const corr = oneByClass(root, 'v2-corrections');
    const statuses = byClass(corr, 'v2-corr').map((n) => n.className.split('--')[1]);
    expect(statuses).toEqual(expect.arrayContaining(['fixed', 'no_page', 'check', 'not_carried']));
    // D-72: the fixed value went to the case card as a suggestion, never written.
    expect(textOf(corr)).toContain('1 corrected value(s) proposed to the case card');
  });

  it('Physical Scan: the 1.2 report with no client block, case-card differences first', async () => {
    const root = await mount();
    await readyDacaCase(root);
    await openStage(root, 'physical_scan');
    await runStage(root, [fakeFile('final-package-scan.pdf')]);

    const card = oneByClass(root, 'v2-result');
    expect(byClass(card, 'psr-summary-strip')).toHaveLength(0); // D-89
    expect(byClass(card, 'psr-client-details')).toHaveLength(0);
    const first = byClass(card, 'psr-notice--needs_attention')[0];
    expect(flatText(first)).toContain('The package shows the phone as (602) 555-0199.');
    expect(byClass(card, 'psr-table')).toHaveLength(1); // Included in the scan
    // The suppressed reasoning never comes back (D-59); the other suggestion does.
    const pi = oneByClass(card, 'ps-explore');
    expect(textOf(pi)).toContain('EAD copy may not be enlarged');
    expect(textOf(pi)).not.toContain('Attorney signed before the applicant');
    expect(textOf(card)).toContain('Staff review is still required before filing.');
  });

  it('General: two equal case cards, people and evidence, one evidence-vs-forms difference', async () => {
    const root = await mount();
    await startCase(root, 'general', 'Morales and Reyes');
    await openStage(root, 'physical_scan');
    await runStage(root, [fakeFile('aos-package-scan.pdf')]);

    const cards = byClass(root, 'v2-person-card');
    expect(cards).toHaveLength(2); // D-99
    expect(cards.map((c) => textOf(c))).toEqual(expect.arrayContaining([expect.stringContaining('LUCIA REYES'), expect.stringContaining('DANIEL MORALES')]));
    const people = oneByClass(root, 'v2-ps-people');
    expect(byClass(people, 'v2-ps-person')).toHaveLength(2);
    const result = oneByClass(root, 'v2-result');
    const attention = byClass(result, 'psr-notice--needs_attention');
    expect(attention).toHaveLength(1);
    expect(flatText(attention[0])).toContain("The beneficiary's birth certificate shows date of birth 09/30/1993. The I-485 shows 09/03/1993.");
  });

  it('reopening a case reads the stored run back and draws the same result', async () => {
    let root = await mount();
    await readyDacaCase(root);
    await openStage(root, 'draft_review');
    await runStage(root, [fakeFile('daca-drafts.pdf')]);
    const before = textOf(oneByClass(root, 'v2-result'));

    root = await mount();
    await click(oneByClass(root, 'v2-case-row'));
    await flush();
    api.getRun.mockClear();
    await openStage(root, 'draft_review');
    expect(api.getRun).toHaveBeenCalledTimes(1);
    expect(textOf(oneByClass(root, 'v2-result'))).toBe(before);
  });

  it('shows the server\'s verdict and counts, never its own', () => {
    // A stored result whose checks look clean, but the server says otherwise:
    // the page shows exactly what the server stored.
    const result = {
      case_type: 'daca_renewal', case_type_label: 'DACA renewal', stage: 'draft_review', stage_label: 'Draft Review', scope: 'whole',
      report_state: 'items_need_attention', primary_report_language: 'SERVER WORDING 7', attention_count: 7,
      attention: [], checks: [{ rule_id: 'PS-101', status: 'clear', title: 'Edition dates current.', form: null }],
      package_items: [], later: [], notes: [], forms_found: [], evidence_matches: [], scan: { files: [{ filename: 'a.pdf' }] },
    };
    const mountNode = document.createElement('div');
    renderReviewResult(result, mountNode);
    expect(oneByClass(mountNode, 'psr-verdict').textContent).toBe('SERVER WORDING 7');
    expect(oneByClass(mountNode, 'psr-verdict').className).toContain('psr-verdict--attention');
    expect(reviewModel(result).attention_count).toBe(7);
    expect(physicalScanReport({ ...result, stage: 'physical_scan' }).primary_report_language).toBe('SERVER WORDING 7');
  });
});

// ── Text only (D-41) ─────────────────────────────────────────────────────────

describe('text only', () => {
  const HOSTILE = '<img src=x onerror=alert(1)><script>alert("x")</script>';

  it('draws hostile strings from a stored result as literal text', () => {
    const result = {
      case_type: 'general', case_type_label: 'General', stage: 'physical_scan', stage_label: 'Physical Scan',
      report_state: 'items_need_attention', primary_report_language: '1 item needs attention', attention_count: 1,
      attention: [{ kind: 'evidence_difference', key: 'k', title: `${HOSTILE} shows date of birth.` }],
      checks: [{ rule_id: 'PS-101', status: 'needs_attention', title: HOSTILE, form: HOSTILE, reason: HOSTILE, evidence: HOSTILE, locations: [HOSTILE] }],
      package_items: [], later: [], notes: [{ kind: 'never_added', title: HOSTILE }],
      forms_found: [{ form: HOSTILE, person_role: 'beneficiary', values: { first_name: HOSTILE } }],
      evidence_matches: [{ evidence: HOSTILE, source: 'package', owner_roles: ['beneficiary'], field: 'date_of_birth', form: HOSTILE, evidence_value: HOSTILE, form_value: 'x', ok: false, person_role: 'beneficiary' }],
      scan: { files: [{ filename: HOSTILE }] },
    };
    for (const render of [renderReviewResult, renderPhysicalScanResult]) {
      const node = document.createElement('div');
      render({ ...result, stage: render === renderReviewResult ? 'draft_review' : 'physical_scan' }, node);
      renderPossibleIssues(node, [{ id: 'i1', title: HOSTILE, description: HOSTILE, evidence: HOSTILE, why_it_matters: HOSTILE, uncertainty: HOSTILE, status: 'open' }], { api });
      expect(textOf(node)).toContain(HOSTILE);
      expect(findAll(node, (n) => ['img', 'script', 'iframe'].includes(n.tagName))).toHaveLength(0);
      expect(findAll(node, (n) => n.__innerHTML !== undefined)).toHaveLength(0);
    }
  });

  it('draws a hostile filename and facts from an uploaded document as text', async () => {
    const root = await mount();
    await startCase(root, 'daca_renewal', HOSTILE);
    await pickFiles(root, [fakeFile(`${'<b>'}ead.pdf`)]);
    expect(textOf(root)).toContain(HOSTILE);
    expect(textOf(root)).toContain('<b>ead.pdf');
    expect(findAll(root, (n) => ['img', 'script', 'b'].includes(n.tagName))).toHaveLength(0);
  });

  it('has no HTML insertion anywhere in the page source', async () => {
    const sources = import.meta.glob('../../pages/proof-scan-v2/*.{js,html}', { query: '?raw', import: 'default', eager: true });
    expect(Object.keys(sources).length).toBeGreaterThan(8);
    for (const [file, src] of Object.entries(sources)) {
      const code = src.replace(/^\s*\/\/.*$/gm, '');
      expect(code, file).not.toMatch(/\.innerHTML\s*=|insertAdjacentHTML|outerHTML|document\.write|DOMParser|createContextualFragment/);
    }
  });

  it('the browser never evaluates: no engine, evidence matching or correction logic is imported', () => {
    const sources = import.meta.glob('../../pages/proof-scan-v2/*.js', { query: '?raw', import: 'default', eager: true });
    for (const [file, src] of Object.entries(sources)) {
      expect(src, file).not.toMatch(/functions\/api|_proof-scan-v2-engine|evaluateRun|matchEvidence|evaluateCorrections|reportState\(/);
    }
  });

  it('copy has no em dashes', () => {
    const sources = import.meta.glob('../../pages/proof-scan-v2/*.js', { query: '?raw', import: 'default', eager: true });
    for (const [file, src] of Object.entries(sources)) expect(src, file).not.toContain('—');
  });
});

// ── Size limits (D-95) ───────────────────────────────────────────────────────

describe('size limits in the browser', () => {
  const MB = 1024 * 1024;
  const pdf = (name, size) => ({ name, size, type: 'application/pdf' });

  it('matches the server: 12 MB a file, 22 MB a request, 20 files, four types', () => {
    expect(LIMITS).toMatchObject({ fileBytes: 12 * MB, requestBytes: 22 * MB, maxFiles: 20 });
    expect(checkFiles([pdf('a.pdf', 12 * MB)])).toBeNull();
    expect(checkFiles([pdf('a.pdf', 12 * MB + 1)])).toMatchObject({ key: 'limit.file_too_big', vars: { name: 'a.pdf' } });
    expect(checkFiles([pdf('a.pdf', 11 * MB), pdf('b.pdf', 11 * MB)])).toBeNull();
    expect(checkFiles([pdf('c.pdf', 1)], [pdf('a.pdf', 11 * MB), pdf('b.pdf', 11 * MB)])).toMatchObject({ key: 'limit.total_too_big' });
    expect(checkFiles(Array.from({ length: 21 }, (_, i) => pdf(`${i}.pdf`, 1)))).toMatchObject({ key: 'limit.too_many' });
    expect(checkFiles([{ name: 'a.docx', size: 10, type: '' }])).toMatchObject({ key: 'limit.wrong_type' });
    expect(checkFiles([pdf('empty.pdf', 0)])).toMatchObject({ key: 'limit.empty' });
    expect(mediaTypeOf({ name: 'scan.JPG', type: '' })).toBe('image/jpeg');
  });

  it('states the limit on every drop zone', async () => {
    const root = await mount();
    await readyDacaCase(root);
    await openStage(root, 'evidence_zero');
    expect(textOf(oneByClass(root, 'ps-drop'))).toContain('up to 12 MB');
    for (const stage of ['draft_review', 'preflight', 'physical_scan']) {
      await openStage(root, stage);
      expect(textOf(oneByClass(root, 'ps-drop'))).toContain('Up to 12 MB per file and 22 MB per review');
    }
  });

  it('refuses an oversized file before anything is read or sent', async () => {
    const root = await mount();
    await startCase(root, 'daca_renewal', 'Big');
    await pickFiles(root, [fakeFile('huge.pdf', { size: 13 * MB })]);
    expect(api.readDocument).not.toHaveBeenCalled();
    expect(textOf(oneByClass(root, 'v2-error'))).toContain('huge.pdf is 13.0 MB. The limit is 12 MB per file.');
  });

  it('refuses a review over 22 MB in total, and never calls the run route', async () => {
    const root = await mount();
    await readyDacaCase(root);
    await openStage(root, 'draft_review');
    await pickFiles(root, [fakeFile('a.pdf', { size: 11 * MB }), fakeFile('b.pdf', { size: 11 * MB })]);
    await pickFiles(root, [fakeFile('c.pdf', { size: MB })]);
    expect(textOf(oneByClass(root, 'v2-error'))).toContain('The limit is 22 MB per review');
    expect(byClass(root, 'v2-file-name').map((n) => n.textContent)).toEqual(['a.pdf', 'b.pdf']);
    expect(api.run).not.toHaveBeenCalled();
  });
});

// ── SSN reveal only on the eye (D-80) ────────────────────────────────────────

describe('SSN', () => {
  it('stays masked until the eye is pressed; the reveal route is called only then', async () => {
    const root = await mount();
    await readyDacaCase(root);
    await openStage(root, 'evidence_zero');
    expect(api.revealSsn).not.toHaveBeenCalled();
    const summarySsn = oneByClass(oneByClass(root, 'psr-detail--ssn'), 'v2-ssn-text');
    expect(summarySsn.textContent).toBe('•••-••-1234');
    expect(textOf(root)).not.toContain('900-55-1234');

    await click(oneByClass(oneByClass(root, 'psr-detail--ssn'), 'v2-ssn-eye'));
    await flush();
    expect(api.revealSsn).toHaveBeenCalledTimes(1);
    expect(api.revealSsn.mock.calls[0][0]).toMatchObject({ person_id: expect.any(String) });
    expect(summarySsn.textContent).toBe('900-55-1234');
    expect(findAll(root, (n) => n.tagName === 'input' && /v2-input--ssn/.test(n.className))[0].value).toBe('900-55-1234');
    expect(db.rows('sensitive_field_audit').filter((r) => r.action === 'read')).toHaveLength(1);

    await click(oneByClass(oneByClass(root, 'psr-detail--ssn'), 'v2-ssn-eye'));
    await flush();
    expect(summarySsn.textContent).toBe('•••-••-1234');
    expect(api.revealSsn).toHaveBeenCalledTimes(1);
  });

  it('no other request ever carries a full SSN back to the page', async () => {
    const root = await mount();
    await readyDacaCase(root);
    await openStage(root, 'draft_review');
    await runStage(root, [fakeFile('daca-drafts.pdf')]);
    for (const [name, fn] of Object.entries(api)) {
      if (name === 'revealSsn') continue;
      for (const r of fn.mock.results) {
        const res = await r.value;
        expect(JSON.stringify(res?.data ?? {}), name).not.toContain('900-55-1234');
      }
    }
  });
});

// ── The evidence requirement (D-74, D-91) and General (D-95) ─────────────────

describe('evidence requirement', () => {
  it('DACA: stages stay locked with the server\'s reasons until the requirement is met', async () => {
    const root = await mount();
    await startCase(root, 'daca_renewal', 'Gate');
    for (const s of ['draft_review', 'preflight', 'physical_scan']) {
      expect(stepOf(root, s).className).toContain('v2-step--locked');
      expect(stepButton(root, s).disabled).toBe(true);
    }
    expect(byClass(root, 'v2-choose')).toHaveLength(0);
    const gate = textOf(oneByClass(root, 'v2-gate'));
    expect(gate).toContain('Add the EAD in Evidence Zero');
    expect(gate).toContain('Approve the reference record.');

    await pickFiles(root, [fakeFile('ead-ana-rivera.pdf')]);
    await pickFiles(root, [fakeFile('intake-ana-rivera.pdf')]);
    expect(stepButton(root, 'draft_review').disabled).toBe(true); // not approved yet
    await click(oneByClass(root, 'v2-approve'));
    await flush();
    // D-67: approving a ready record moves on to the stage choice.
    expect(byClass(root, 'v2-choose')).toHaveLength(1);
    for (const s of ['draft_review', 'preflight', 'physical_scan']) expect(stepButton(root, s).disabled).toBe(false);
  });

  it('DACA: "There is no evidence for this case" is a deliberate second step', async () => {
    const root = await mount();
    await startCase(root, 'daca_renewal', 'No EAD');
    await click(oneByClass(root, 'v2-noead-ask'));
    expect(textOf(root)).toContain('Only if there really is no evidence');
    await click(oneByClass(root, 'v2-noead-confirm'));
    await flush();
    expect(db.rows('proof_scan_people')[0].no_evidence).toBe(true);
    const gate = textOf(oneByClass(root, 'v2-gate'));
    expect(gate).not.toContain('Add the EAD');
    expect(gate).toContain('Fill in the address');
  });

  it('General: no gate, the stages are open from the start', async () => {
    const root = await mount();
    await startCase(root, 'general', 'Open');
    expect(byClass(root, 'v2-step--locked')).toHaveLength(0);
    expect(byClass(root, 'v2-gate')).toHaveLength(0);
    expect(byClass(root, 'v2-choose')).toHaveLength(1);
    await openStage(root, 'physical_scan');
    expect(oneByClass(root, 'ps-scan-btn')).toBeTruthy();
  });

  it('the tracker reads the server state only', () => {
    const view = {
      case: { case_type: 'daca_renewal' }, evidence_requirement: { ready: true }, documents: [], people: [],
      runs: [{ stage: 'draft_review', report_state: 'no_issues_found' }, { stage: 'preflight', report_state: 'review_incomplete' }],
      signoffs: [{ stage: 'physical_scan' }],
    };
    expect(stepState(view, 'draft_review')).toBe('done');
    expect(stepState(view, 'preflight')).toBe('attention');
    expect(stepState(view, 'physical_scan')).toBe('done');
    expect(stepState({ ...view, evidence_requirement: { ready: false } }, 'preflight')).toBe('locked');
  });
});

// ── Sign-off (D-75) ──────────────────────────────────────────────────────────

describe('sign-off', () => {
  it('a new run clears it, and "go to next stage" opens the next stage', async () => {
    const root = await mount();
    await readyDacaCase(root);
    await openStage(root, 'draft_review');
    await runStage(root, [fakeFile('daca-drafts.pdf')]);

    await change(oneByClass(root, 'v2-signoff-input'), true);
    await flush();
    expect(db.rows('proof_scan_signoffs')).toHaveLength(1);
    expect(oneByClass(root, 'v2-signoff').className).toContain('is-on');
    expect(stepOf(root, 'draft_review').className).toContain('v2-step--done');
    expect(buttonByText(root, 'Go to Physical Scan')).toBeTruthy();

    await runStage(root, [fakeFile('daca-drafts.pdf')]);
    expect(db.rows('proof_scan_signoffs')).toHaveLength(0);
    expect(oneByClass(root, 'v2-signoff-input').checked).toBe(false);
    expect(stepOf(root, 'draft_review').className).toContain('v2-step--attention');

    await change(oneByClass(root, 'v2-signoff-input'), true);
    await flush();
    await click(buttonByText(root, 'Go to Pre-flight'));
    await flush();
    expect(stepOf(root, 'preflight').className).toContain('v2-step--current');
  });
});

// ── Possible issues decisions (D-59, D-60) ───────────────────────────────────

describe('Possible issues', () => {
  it('accept, then suggest as a rule with wording and scope; never changes the result', async () => {
    const root = await mount();
    await readyDacaCase(root);
    await openStage(root, 'draft_review');
    await runStage(root, [fakeFile('daca-drafts.pdf')]);
    const verdict = oneByClass(root, 'psr-verdict').textContent;
    const pi = oneByClass(root, 'ps-explore');
    await click(oneByClass(pi, 'ps-explore-accept'));
    expect(db.rows('proof_scan_possible_issues')[0].status).toBe('accepted');
    await click(oneByClass(pi, 'ps-explore-nominate'));
    const editor = oneByClass(pi, 'v2-suggest');
    byTag(editor, 'textarea')[0].value = 'Phone numbers use one format across the package.';
    await click(oneByClass(editor, 'v2-suggest-save'));
    await flush();
    expect(db.rows('proof_scan_rules').some((r) => r.title === 'Phone numbers use one format across the package.' && r.origin === 'possible_issue')).toBe(true);
    expect(oneByClass(root, 'psr-verdict').textContent).toBe(verdict);
  });
});
