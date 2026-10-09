// api.js: the Proof Scan v2 routes (Batch 2), as plain calls. No DOM.
//
// Every call is authenticated with the staff session and returns
// { ok, status, data }. A network failure is { ok: false, status: 0 } with a
// message, never a thrown error, so the screens always have something honest
// to say. Evidence Zero sends its one document as base64, the v1.2 way. A stage
// run uploads each file to R2 and runs as a server-side job: run() uploads,
// queues, starts the job, and polls until the stored
// result is back, then answers in the same shape the inline route did, so the
// screens do not know the difference. Nothing is kept by the browser (D-84).

import { mediaTypeOf } from './model.js';

const NETWORK = 'Could not reach the portal. Check your connection and try again.';

// How often a running stage is polled, and for how long before the page stops
// waiting. The run carries on regardless; it lands in the case when it is done.
const POLL_MS = 3000;
const POLL_FOR_MS = 20 * 60_000;
const STILL_RUNNING = 'The review is still running. It will appear in this case when it finishes; reopen the case in a few minutes.';

export function createApi({
  fetchImpl = globalThis.fetch?.bind(globalThis), getToken,
  wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), pollMs = POLL_MS, pollForMs = POLL_FOR_MS,
} = {}) {
  async function call(method, path, { body, query } = {}) {
    let url = path;
    if (query) {
      const q = Object.entries(query).filter(([, v]) => v != null && v !== '')
        .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
      if (q) url += `?${q}`;
    }
    let res;
    try {
      const token = getToken ? await getToken() : null;
      const headers = { 'Content-Type': 'application/json' };
      if (token) headers.Authorization = `Bearer ${token}`;
      res = await fetchImpl(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    } catch {
      return { ok: false, status: 0, data: { error: NETWORK } };
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { ok: res.ok, status: res.status, data: data || {} };
  }

  // The raw bytes of one file to R2, through the same staging route the live
  // checker uses. Returns { ok, status, data: { upload_id } }.
  async function upload(file) {
    let res;
    try {
      const token = getToken ? await getToken() : null;
      const headers = { 'Content-Type': mediaTypeOf(file) || 'application/pdf' };
      if (token) headers.Authorization = `Bearer ${token}`;
      res = await fetchImpl('/api/proof-scan-upload', { method: 'PUT', headers, body: await file.arrayBuffer() });
    } catch {
      return { ok: false, status: 0, data: { error: NETWORK } };
    }
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    return { ok: res.ok, status: res.status, data: data || {} };
  }

  async function runStaged({ caseId, stage, scope, form, files, email }) {
    const staged = [];
    for (const { file, kind } of files) {
      const up = await upload(file);
      if (!up.ok) return up;
      staged.push({
        filename: file.name, media_type: mediaTypeOf(file), upload_id: up.data.upload_id,
        ...(kind && kind !== 'package' ? { kind } : {}),
      });
    }
    const queued = await call('POST', '/api/proof-scan-v2-run', {
      body: {
        case_id: caseId, stage,
        ...(scope ? { scope } : {}),
        ...(form ? { form } : {}),
        files: staged,
        ...(email ? { email: true } : {}),
      },
    });
    if (!queued.ok) return queued;
    const runId = queued.data.run_id;

    // Start it now rather than on the next cron tick. Not awaited: this request
    // stays open for the whole model call, and the poll below is what the page
    // follows. If it is lost, the sweeper runs the job.
    call('POST', '/api/proof-scan-v2-process', { body: { run_id: runId } }).catch(() => {});

    const deadline = Date.now() + pollForMs;
    for (;;) {
      await wait(pollMs);
      const res = await call('GET', '/api/proof-scan-v2-run', { query: { id: runId } });
      const run = res.ok ? res.data.run : null;
      if (run?.status === 'structured') {
        const view = await call('GET', '/api/proof-scan-v2-case', { query: { id: caseId } });
        return {
          ok: true, status: 200,
          data: {
            run_id: runId, stored: true, storage_error: null,
            follow_up_error: res.data.outcome?.follow_up_error ?? null,
            notification_attempted: Boolean(res.data.outcome?.notification_attempted),
            notification_sent: Boolean(res.data.outcome?.notification_sent),
            result: run.result_json, possible_issues: res.data.possible_issues || [],
            ...(view.ok ? { case_view: view.data } : {}),
          },
        };
      }
      if (run?.status === 'error') {
        return { ok: false, status: 502, data: { error: run.error_detail || 'The review could not be completed. Nothing was saved. Please try again.', report_state: 'scan_could_not_be_completed' } };
      }
      // A failed poll is not a failed run; keep following it until the deadline.
      if (Date.now() > deadline) return { ok: false, status: 0, data: { error: STILL_RUNNING } };
    }
  }

  return {
    // Cases (D-77, D-83)
    findCases: (q) => call('GET', '/api/proof-scan-v2-cases', { query: { q } }),
    createCase: (caseType) => call('POST', '/api/proof-scan-v2-case', { body: { case_type: caseType } }),
    getCase: (id) => call('GET', '/api/proof-scan-v2-case', { query: { id } }),

    // People and the reference record (D-10, D-94)
    person: (body) => call('POST', '/api/proof-scan-v2-person', { body }),
    suggestion: (suggestionId, decision) => call('POST', '/api/proof-scan-v2-suggestion', { body: { suggestion_id: suggestionId, decision } }),
    saveSsn: (personId, ssn) => call('POST', '/api/proof-scan-v2-ssn', { body: { action: 'save', person_id: personId, ssn } }),
    // The audited reveal (D-80). Only ever called when staff press the eye.
    revealSsn: (target) => call('POST', '/api/proof-scan-v2-ssn', {
      body: target.suggestion_id ? { action: 'reveal', suggestion_id: target.suggestion_id } : { action: 'reveal', person_id: target.person_id },
    }),

    // Evidence Zero (D-53)
    readDocument: async (caseId, file) => call('POST', '/api/proof-scan-v2-evidence', {
      body: { case_id: caseId, ...(await filePayload(file)) },
    }),
    correctDocument: (body) => call('PATCH', '/api/proof-scan-v2-evidence', { body }),
    removeDocument: (documentId) => call('DELETE', '/api/proof-scan-v2-evidence', { body: { document_id: documentId } }),

    // Stages
    run: runStaged,
    getRun: (id) => call('GET', '/api/proof-scan-v2-run', { query: { id } }),
    signOff: (caseId, stage, on) => call(on ? 'POST' : 'DELETE', '/api/proof-scan-v2-signoff', { body: { case_id: caseId, stage } }),

    // Possible issues (D-59, D-60)
    possibleIssue: (body) => call('POST', '/api/proof-scan-v2-possible-issue', { body }),

    // Rulebook (D-61, D-65, D-76)
    rules: (caseType) => call('GET', '/api/proof-scan-v2-rules', { query: { case_type: caseType } }),
    addRule: (body) => call('POST', '/api/proof-scan-v2-rules', { body }),
    editRule: (body) => call('PATCH', '/api/proof-scan-v2-rules', { body }),
    suppressions: () => call('GET', '/api/proof-scan-v2-suppressions'),
  };
}

// base64 without FileReader, so it works on a File and on a test double alike.
export async function toBase64(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  return btoa(binary);
}

async function filePayload(file) {
  return { filename: file.name, media_type: mediaTypeOf(file), file_base64: await toBase64(file) };
}

// What staff are told when a call fails. The server's own words when it gave
// some; never anything reassuring.
export function errorText(res) {
  if (res?.data?.error && typeof res.data.error === 'string') return res.data.error;
  if (res?.status === 401 || res?.status === 403) return 'Your session is not authorised for Proof Scan. Sign in again.';
  return `The request failed (${res?.status || 'no response'}). Nothing was changed.`;
}
