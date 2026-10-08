// api.js: the Proof Scan v2 routes (Batch 2), as plain calls. No DOM.
//
// Every call is authenticated with the staff session and returns
// { ok, status, data }. A network failure is { ok: false, status: 0 } with a
// message, never a thrown error, so the screens always have something honest
// to say. File contents are read here and sent as base64 the v1.2 way; they are
// never kept by the browser after the request (D-84).

import { mediaTypeOf } from './model.js';

const NETWORK = 'Could not reach the portal. Check your connection and try again.';

export function createApi({ fetchImpl = globalThis.fetch?.bind(globalThis), getToken } = {}) {
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
    run: async ({ caseId, stage, scope, form, files, email }) => call('POST', '/api/proof-scan-v2-run', {
      body: {
        case_id: caseId,
        stage,
        ...(scope ? { scope } : {}),
        ...(form ? { form } : {}),
        files: await Promise.all(files.map(async ({ file, kind }) => ({ ...(await filePayload(file)), ...(kind && kind !== 'package' ? { kind } : {}) }))),
        ...(email ? { email: true } : {}),
      },
    }),
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
