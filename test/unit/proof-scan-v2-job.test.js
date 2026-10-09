// Proof Scan v2: staged stage runs as queued jobs (_proof-scan-v2-job.js).
// A full package is uploaded to R2, queued as a row, and run off the request
// path by /api/proof-scan-v2-process or the cron sweeper. The model is mocked
// and every answer is synthetic; R2 is an in-memory bucket.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({ verifyAuth: vi.fn(), makeAdminClient: vi.fn() }));
vi.mock('../../functions/api/_helpers.js', async (importOriginal) => ({
  ...(await importOriginal()),
  verifyAuth: helpersMock.verifyAuth,
  makeAdminClient: helpersMock.makeAdminClient,
}));

import { onRequest as runRoute } from '../../functions/api/proof-scan-v2-run.js';
import { onRequest as processRoute } from '../../functions/api/proof-scan-v2-process.js';
import { runProofScanV2Sweep, sweepVerdict } from '../../functions/api/_proof-scan-v2-job.js';
import { claimScan, runProofScanSweep } from '../../functions/api/_proof-scan-run.js';
import { tmpKey } from '../../functions/api/proof-scan-upload.js';
import { listRuns } from '../../functions/api/_proof-scan-v2-store.js';
import {
  seededDb, call, ENV, STAFF, CLIENT, mockModel, observations,
} from '../support/proof-scan-v2-harness.js';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n');

function fakeR2() {
  const objects = new Map();
  return {
    objects,
    async put(key, bytes) { objects.set(key, bytes); return { size: bytes.length }; },
    async get(key) {
      const bytes = objects.get(key);
      return bytes ? { size: bytes.length, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length) } : null;
    },
    async delete(keys) { for (const k of [].concat(keys)) objects.delete(k); },
  };
}

let db;
let env;
beforeEach(() => {
  vi.clearAllMocks();
  db = seededDb();
  env = { ...ENV, R2: fakeR2() };
  helpersMock.makeAdminClient.mockReturnValue(db);
  helpersMock.verifyAuth.mockResolvedValue(STAFF);
  globalThis.fetch = vi.fn(async () => { throw new Error('unexpected network call'); });
});

function generalCase() {
  const id = crypto.randomUUID();
  db.rows('proof_scan_cases').push({ id, case_type: 'general', label: 'Test', created_at: '2026-10-07T00:00:00Z' });
  return id;
}
async function stage(bytes = PDF_BYTES) {
  const uploadId = crypto.randomUUID();
  await env.R2.put(tmpKey(uploadId), bytes);
  return uploadId;
}
const stagedFile = (upload_id, extra = {}) => ({ filename: 'package.pdf', media_type: 'application/pdf', upload_id, ...extra });
const queue = (body) => call(runRoute, '/api/proof-scan-v2-run', { method: 'POST', body }, env);
const process = (run_id) => call(processRoute, '/api/proof-scan-v2-process', { method: 'POST', body: { run_id } }, env);
const poll = (id) => call(runRoute, '/api/proof-scan-v2-run', { query: { id } }, env);
const row = (id) => db.rows('proof_scans').find((r) => r.id === id);

async function queuedRun(extra = {}) {
  const caseId = generalCase();
  const uploadId = await stage();
  const r = await queue({ case_id: caseId, stage: 'physical_scan', files: [stagedFile(uploadId)], ...extra });
  return { caseId, uploadId, runId: r.body.run_id, res: r };
}

describe('queueing a staged run', () => {
  it('answers 202 with a queued row and calls no model', async () => {
    const { res, runId, caseId } = await queuedRun();
    expect(res.status).toBe(202);
    expect(res.body).toEqual({ run_id: runId, status: 'queued' });
    expect(row(runId)).toMatchObject({ status: 'queued', case_id: caseId, stage: 'physical_scan', rule_set_version: 1 });
    expect(row(runId).result_json).toBeUndefined();
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('keeps a queued run out of the case view and the tracker', async () => {
    const { caseId } = await queuedRun();
    expect(await listRuns(db, caseId)).toEqual([]);
  });

  it('refuses a mix of inline and staged files, and a bad upload id', async () => {
    const caseId = generalCase();
    const uploadId = await stage();
    const mixed = await queue({ case_id: caseId, stage: 'physical_scan', files: [stagedFile(uploadId), { filename: 'a.pdf', media_type: 'application/pdf', file_base64: 'JVBERi0=' }] });
    expect(mixed.status).toBe(400);
    const bad = await queue({ case_id: caseId, stage: 'physical_scan', files: [stagedFile('../../etc/passwd')] });
    expect(bad.status).toBe(400);
    expect(db.rows('proof_scans')).toHaveLength(0);
  });

  it('refuses the Client role before anything is queued', async () => {
    helpersMock.verifyAuth.mockResolvedValue(CLIENT);
    const caseId = generalCase();
    const r = await queue({ case_id: caseId, stage: 'physical_scan', files: [stagedFile(await stage())] });
    expect(r.status).toBe(403);
    expect(db.rows('proof_scans')).toHaveLength(0);
  });
});

describe('running it', () => {
  it('stores the structured result, drops the staged file, and the poll returns it', async () => {
    const { runId, uploadId } = await queuedRun();
    mockModel(vi, [observations()]);
    expect((await process(runId)).body).toEqual({ status: 'structured' });

    expect(row(runId)).toMatchObject({ status: 'structured', report_state: expect.any(String), model: 'claude-sonnet-5-5', attempts: 1 });
    expect(row(runId).completed_at).toBeTruthy();
    expect(env.R2.objects.has(tmpKey(uploadId))).toBe(false);

    const p = await poll(runId);
    expect(p.status).toBe(200);
    expect(p.body.run.status).toBe('structured');
    expect(p.body.run.result_json.report_state).toBe(row(runId).report_state);
    expect(p.body.run.job).toBeUndefined(); // upload ids never leave the server
    expect(p.body.outcome).toMatchObject({ follow_up_error: null, notification_attempted: false });
    expect(row(runId).job.files).toEqual([]);
  });

  it('runs once: a second process call claims nothing and calls no model', async () => {
    const { runId } = await queuedRun();
    const calls = mockModel(vi, [observations()]);
    await process(runId);
    const again = await process(runId);
    expect(again.body).toEqual({ status: 'structured' });
    expect(calls).toHaveLength(1);
  });

  it('records a staged file that is gone as an error the page can show', async () => {
    const { runId, uploadId } = await queuedRun();
    await env.R2.delete(tmpKey(uploadId));
    expect((await process(runId)).body).toEqual({ status: 'error' });
    expect(row(runId).status).toBe('error');
    expect(row(runId).error_detail).toMatch(/no longer in storage/);
    expect((await poll(runId)).body.run.error_detail).toMatch(/no longer in storage/);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it('checks the real bytes, not the upload\'s claimed type', async () => {
    const caseId = generalCase();
    const uploadId = await stage(new TextEncoder().encode('MZ not a pdf at all'));
    const { body } = await queue({ case_id: caseId, stage: 'physical_scan', files: [stagedFile(uploadId)] });
    expect((await process(body.run_id)).body).toEqual({ status: 'error' });
    expect(row(body.run_id).error_detail).toMatch(/not the kind of file/);
    expect(env.R2.objects.size).toBe(0);
  });

  it('fails closed on a model failure: error row, nothing stored, file dropped', async () => {
    const { runId, uploadId } = await queuedRun();
    mockModel(vi, [{ httpStatus: 529 }]);
    expect((await process(runId)).body).toEqual({ status: 'error' });
    expect(row(runId).status).toBe('error');
    expect(row(runId).result_json).toBeUndefined();
    expect(env.R2.objects.has(tmpKey(uploadId))).toBe(false);
  });

  it('fails closed on a truncated answer', async () => {
    const { runId } = await queuedRun();
    mockModel(vi, [{ output: observations(), stop_reason: 'max_tokens' }]);
    await process(runId);
    expect(row(runId).status).toBe('error');
  });

  it('only staff may start a run', async () => {
    const { runId } = await queuedRun();
    helpersMock.verifyAuth.mockResolvedValue(CLIENT);
    expect((await process(runId)).status).toBe(403);
    expect(row(runId).status).toBe('queued');
  });
});

describe('the live checker and v2 share the table, never each other\'s rows', () => {
  it('the live claim will not take a v2 run', async () => {
    const { runId } = await queuedRun();
    expect(await claimScan(db, runId)).toBeNull();
    expect(row(runId).status).toBe('queued');
  });

  it('the v2 process route will not take a live checker scan', async () => {
    db.rows('proof_scans').push({ id: 'live-1', status: 'queued', case_id: null, filename: 'pkg.pdf', created_at: '2026-10-07T00:00:00Z' });
    const r = await call(processRoute, '/api/proof-scan-v2-process', { method: 'POST', body: { run_id: crypto.randomUUID() } }, env);
    expect(r.status).toBe(404);
    expect(row('live-1').status).toBe('queued');
  });

  it('each sweeper leaves the other\'s rows alone', async () => {
    const { runId } = await queuedRun();
    row(runId).created_at = '2026-01-01T00:00:00Z';
    db.rows('proof_scans').push({ id: 'live-1', status: 'queued', case_id: null, filename: 'pkg.pdf', created_at: '2026-01-01T00:00:00Z' });
    // The live sweeper would claim live-1 and run the HTML scan; stop it at the
    // R2 read by giving it no bucket. What matters is it never touches the v2 row.
    await runProofScanSweep({ ...ENV });
    expect(row(runId).status).toBe('queued');

    mockModel(vi, [observations()]);
    await runProofScanV2Sweep(env);
    expect(row(runId).status).toBe('structured');
  });
});

describe('the v2 sweeper', () => {
  it('runs a queued run the page never started', async () => {
    const { runId } = await queuedRun();
    row(runId).created_at = '2026-01-01T00:00:00Z';
    mockModel(vi, [observations()]);
    await runProofScanV2Sweep(env);
    expect(row(runId).status).toBe('structured');
  });

  it('leaves a just-queued run for the page to start', async () => {
    const { runId } = await queuedRun();
    row(runId).created_at = new Date().toISOString();
    await runProofScanV2Sweep(env);
    expect(row(runId).status).toBe('queued');
  });

  it('requeues a run stuck in processing, and gives up after two attempts', async () => {
    const { runId } = await queuedRun();
    Object.assign(row(runId), { status: 'processing', started_at: '2026-01-01T00:00:00Z', attempts: 1, created_at: new Date().toISOString() });
    await runProofScanV2Sweep(env);
    expect(row(runId).status).toBe('queued');

    Object.assign(row(runId), { status: 'processing', started_at: '2026-01-01T00:00:00Z', attempts: 2 });
    await runProofScanV2Sweep(env);
    expect(row(runId)).toMatchObject({ status: 'error', error_detail: expect.stringMatching(/more than once/) });
  });

  it('decides wait / requeue / abandon from the claim time and attempts', () => {
    const now = Date.parse('2026-10-07T12:00:00Z');
    expect(sweepVerdict({ started_at: '2026-10-07T11:55:00Z', attempts: 1 }, now)).toBe('wait');
    expect(sweepVerdict({ started_at: '2026-10-07T11:30:00Z', attempts: 1 }, now)).toBe('requeue');
    expect(sweepVerdict({ started_at: '2026-10-07T11:30:00Z', attempts: 2 }, now)).toBe('abandon');
    expect(sweepVerdict({ started_at: null, attempts: 0 }, now)).toBe('requeue');
  });
});
