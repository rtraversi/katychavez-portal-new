// Proof Scan v2 local preview. NOT PRODUCTION CODE. Run with:
//
//   npm run preview:proof-scan-v2
//
// then open the URL it prints. It serves the REAL v2 page (pages/proof-scan-v2/)
// inside a light copy of the portal chrome, and answers its API calls with the
// REAL v2 route handlers (functions/api/proof-scan-v2-*.js) and the REAL server
// engine, against an in-memory database. Three things are stood in:
//
//   * sign-in: every request is a preview staff member (preview-helpers.mjs)
//   * the database: test/support/fake-supabase.js, seeded with the v2 rule sets
//   * the AI: scenarios.mjs answers with synthetic observations; nothing is
//     sent to Anthropic, and the email "send" goes nowhere
//
// Nothing here is deployed (test/ is in .assetsignore) and nothing touches a
// real database, a real model or a real inbox. Restarting resets everything.

import { registerHooks } from 'node:module';
import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve, extname, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, '../../..');

// ── Swap the auth/database helpers for the preview stand-in ─────────────────
const realHelpers = pathToFileURL(join(repo, 'functions/api/_helpers.js')).href;
const stubHelpers = pathToFileURL(join(here, 'preview-helpers.mjs')).href;
registerHooks({
  resolve(specifier, context, next) {
    const r = next(specifier, context);
    if (r.url === realHelpers && context.parentURL !== stubHelpers) return { ...r, url: stubHelpers, shortCircuit: true };
    return r;
  },
});

const { createFakeSupabase } = await import('../../support/fake-supabase.js');
const { modelAnswer, SAMPLES, samplePdf } = await import('./scenarios.mjs');

// ── The fake database, seeded the way migration 2003 seeds the real one ─────
const db = createFakeSupabase();
globalThis.__PS2_PREVIEW_DB__ = db;
const seed = JSON.parse(readFileSync(join(repo, 'functions/api/proof-scan-profiles/v2-seed.json'), 'utf8'));
for (const rs of seed.rule_sets) {
  const setId = `rs-${rs.case_type}-1`;
  db.rows('proof_scan_rule_sets').push({ id: setId, case_type: rs.case_type, version: rs.version, is_current: true, label: rs.label, source_note: rs.source_note, created_by: null, created_at: '2026-10-07T00:00:00Z' });
  rs.package_items.forEach((item, i) => db.rows('proof_scan_package_items').push({ id: `pi-${rs.case_type}-${item.item_id}`, rule_set_id: setId, instance: null, ...item, sort_order: i + 1 }));
  rs.rules.forEach((r, i) => {
    const { stages, ...rest } = r;
    const pk = `r-${rs.case_type}-${r.rule_id}`;
    db.rows('proof_scan_rules').push({ id: pk, rule_set_id: setId, form: null, page: null, item: null, expected: null, note: null, source_note: null, pass_text: null, retired: false, ...rest, sort_order: i + 1 });
    for (const [stage, s] of Object.entries(stages)) {
      db.rows('proof_scan_rule_stage_settings').push({ id: `ss-${pk}-${stage}`, rule_pk: pk, stage, state: s.state, stage_title: s.stage_title ?? null, stage_pass_text: s.stage_pass_text ?? null, stage_expected: s.stage_expected ?? null, gentle_if_no: Boolean(s.gentle_if_no) });
    }
  });
}
db.rows('proof_scan_suppressions').push({ id: 'sup-r1', reasoning_key: 'signature_date_order', label: 'Signature date order, for example an attorney signing before the applicant. Not a requirement at this firm.', origin: 'firm_decision', created_by: null, created_at: '2026-10-07T00:00:00Z' });
db.rows('proof_scan_config').push({ id: 'cfg', notify_email: 'alerts@example.test' });

// ── The AI and the mailer, stood in ─────────────────────────────────────────
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.anthropic.com/')) {
    const answer = modelAnswer(JSON.parse(opts.body));
    return new Response(JSON.stringify({
      model: 'preview-canned-answers', stop_reason: 'end_turn',
      content: [{ type: 'text', text: JSON.stringify(answer) }], usage: { input_tokens: 0, output_tokens: 0 },
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  }
  if (u.startsWith('https://api.resend.com/')) return new Response('{"id":"preview"}', { status: 200 });
  return realFetch(url, opts);
};

const ENV = {
  ANTHROPIC_API_KEY: 'preview-not-a-key', RESEND_API_KEY: 'preview-not-a-key',
  SSN_ENCRYPTION_KEY: '0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c4b5a69788796a5b4c3d2e1f0',
  PORTAL_URL: 'http://127.0.0.1', PORTAL_FIRM_NAME: 'Preview Firm', PORTAL_FROM_EMAIL: 'preview@example.test',
};

const ROUTES = {};
for (const name of ['case', 'cases', 'person', 'suggestion', 'ssn', 'evidence', 'run', 'signoff', 'rules', 'suppressions', 'possible-issue']) {
  ROUTES[`/api/proof-scan-v2-${name}`] = (await import(`../../../functions/api/proof-scan-v2-${name}.js`)).onRequest;
}

async function call(path, method, body, query) {
  const url = new URL(`http://preview.local${path}`);
  for (const [k, v] of Object.entries(query || {})) url.searchParams.set(k, v);
  const request = new Request(url, { method, headers: { 'content-type': 'application/json', authorization: 'Bearer preview' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const res = await ROUTES[path]({ request, env: ENV });
  return { status: res.status, body: await res.json() };
}
const file = (filename, kind) => ({ filename, media_type: 'application/pdf', file_base64: samplePdf(filename).toString('base64'), ...(kind ? { kind } : {}) });
const must = (r, what) => { if (r.status >= 300) throw new Error(`preview seed failed at ${what}: ${r.status} ${JSON.stringify(r.body)}`); return r.body; };

// ── Seeded cases: what the brief asked Max to be able to see ────────────────
async function seedCases() {
  // 1. A DACA renewal through all four stages.
  let v = must(await call('/api/proof-scan-v2-case', 'POST', { case_type: 'daca_renewal', label: 'Rivera, Ana' }), 'DACA case');
  const daca = v.case.id;
  const ana = v.people[0].id;
  must(await call('/api/proof-scan-v2-evidence', 'POST', { case_id: daca, ...file('ead-ana-rivera.pdf') }), 'EAD');
  must(await call('/api/proof-scan-v2-evidence', 'POST', { case_id: daca, ...file('intake-ana-rivera.pdf') }), 'intake');
  must(await call('/api/proof-scan-v2-person', 'POST', { action: 'approve', person_id: ana }), 'approve');
  must(await call('/api/proof-scan-v2-run', 'POST', { case_id: daca, stage: 'draft_review', scope: 'whole', files: [file('daca-drafts.pdf')] }), 'Draft Review');
  must(await call('/api/proof-scan-v2-signoff', 'POST', { case_id: daca, stage: 'draft_review' }), 'sign-off');
  must(await call('/api/proof-scan-v2-run', 'POST', {
    case_id: daca, stage: 'preflight', scope: 'whole',
    files: [file('corrected-forms.pdf'), file('client-markups.pdf', 'marked'), file('corrected-pages.pdf', 'corrected')],
  }), 'Pre-flight');
  must(await call('/api/proof-scan-v2-run', 'POST', { case_id: daca, stage: 'physical_scan', files: [file('final-package-scan.pdf')], email: true }), 'Physical Scan');

  // 2. A General, AOS-style package: two people, one evidence-vs-forms difference.
  v = must(await call('/api/proof-scan-v2-case', 'POST', { case_type: 'general', label: 'Morales, Daniel and Reyes, Lucia' }), 'General case');
  must(await call('/api/proof-scan-v2-run', 'POST', { case_id: v.case.id, stage: 'physical_scan', files: [file('aos-package-scan.pdf')] }), 'General Physical Scan');

  // 3. A DACA renewal still in Evidence Zero: replaced EAD, suggestions, a damaged copy.
  v = must(await call('/api/proof-scan-v2-case', 'POST', { case_type: 'daca_renewal', label: 'Garcia, Luis' }), 'Garcia case');
  for (const name of ['ead-luis-garcia.pdf', 'intake-luis-garcia.pdf', 'ead-newer-luis-garcia.pdf', 'intake-updated-luis-garcia.pdf', 'ead-damaged-luis-garcia.pdf']) {
    must(await call('/api/proof-scan-v2-evidence', 'POST', { case_id: v.case.id, ...file(name) }), name);
  }
}
await seedCases();

// ── HTTP ─────────────────────────────────────────────────────────────────────
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.ico': 'image/x-icon' };
// Only what the browser needs. Server code, config and secrets are never served.
const SERVED = ['css/', 'js/', 'pages/', 'modules/', 'assets/', 'test/fixtures/proof-scan-v2/'];

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://preview.local');
    const path = decodeURIComponent(url.pathname);
    if (path === '/') { res.writeHead(302, { location: '/test/fixtures/proof-scan-v2/preview.html' }); res.end(); return; }
    if (path === '/__samples.json') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(SAMPLES)); return; }
    if (path.startsWith('/__samples/')) {
      const name = path.slice('/__samples/'.length).replace(/[^a-z0-9.-]/gi, '');
      res.writeHead(200, { 'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${name}"` });
      res.end(samplePdf(name));
      return;
    }
    if (ROUTES[path]) {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(url, { method: req.method, headers: { 'content-type': 'application/json', authorization: 'Bearer preview' }, body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body });
      const out = await ROUTES[path]({ request, env: ENV });
      res.writeHead(out.status, { 'content-type': 'application/json' });
      res.end(await out.text());
      return;
    }
    const rel = path.replace(/^\/+/, '');
    const full = resolve(repo, rel);
    if (!full.startsWith(repo + sep) || !SERVED.some((p) => rel.startsWith(p))) { res.writeHead(404); res.end('Not found'); return; }
    const s = await stat(full).catch(() => null);
    if (!s?.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'content-type': TYPES[extname(full)] || 'application/octet-stream', 'cache-control': 'no-store' });
    res.end(await readFile(full));
  } catch (err) {
    console.error('[preview]', err);
    res.writeHead(500, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ error: 'Preview server error' }));
  }
});

const port = Number(process.env.PORT) || 8788;
server.listen(port, '127.0.0.1', () => {
  console.log('\nProof Scan v2 local preview (synthetic data, nothing leaves this machine)');
  console.log(`  open  http://127.0.0.1:${port}/`);
  console.log('  stop  Ctrl+C. Restarting resets every case.\n');
});
