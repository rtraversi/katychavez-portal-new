// _proof-scan-v2-job.js: running a staged Proof Scan v2 stage run off the
// request path. NOT a route.
//
// The live checker's job pattern (_proof-scan-run.js), applied to v2:
//
//   POST /api/proof-scan-v2-run with staged files  -> a 'queued' proof_scans row
//   POST /api/proof-scan-v2-process { run_id }      fired by the page, not awaited
//   runProofScanV2Sweep()                           the 5-minute cron, for runs the
//                                                   fast path never claimed or lost
//   GET  /api/proof-scan-v2-run?id=                 the page polls the row
//
// A queued run is a row, not a live request, so a closed tab loses nothing and
// a package the size of a full AOS filing never has to finish inside one HTTP
// request. Claim protocol is the same conditional UPDATE: queued -> processing
// -> structured | error, so a run is never executed (or billed) twice.

import { makeAdminClient } from './_helpers.js';
import { checkFiles, MAX_STAGED_TOTAL_BYTES, MAX_STAGED_TOTAL_MB } from './_proof-scan-v2-http.js';
import * as store from './_proof-scan-v2-store.js';
import { prepareRun, executeRun, storedRunFields, completeRun } from './proof-scan-v2-run.js';
import { tmpKey } from './proof-scan-upload.js';
import { bytesToBase64 } from './_segment-package.js';

// A runner that has not finished by now is gone (its model call times out at
// 9 minutes, _proof-scan-v2-ai.js). Same thresholds as the live checker.
const STUCK_AFTER_MS = 12 * 60_000;
const QUEUED_GRACE_MS = 90_000;
const MAX_ATTEMPTS = 2;

// Same rule as the live sweeper: wait, requeue, or give up. Pure, for tests.
export function sweepVerdict(row, nowMs) {
  const started = Date.parse(row.started_at ?? '');
  if (Number.isFinite(started) && nowMs - started < STUCK_AFTER_MS) return 'wait';
  return (row.attempts ?? 0) >= MAX_ATTEMPTS ? 'abandon' : 'requeue';
}

async function dropStaged(env, files) {
  if (!env.R2) return;
  await Promise.all((files || []).map((f) => env.R2.delete(tmpKey(f.upload_id)).catch(() => {})));
}

// Reads the staged bytes back as the inline shape executeRun takes. Returns
// { files } or { error } in words staff can act on.
async function loadStaged(env, staged) {
  if (!env.R2) return { error: 'Storage is not configured on this portal.' };
  const files = [];
  for (const f of staged) {
    const obj = await env.R2.get(tmpKey(f.upload_id));
    if (!obj) return { error: `${f.filename} was no longer in storage when the review started. Add it again and rerun.` };
    if (obj.size > MAX_STAGED_TOTAL_BYTES) return { error: `${f.filename} is larger than ${MAX_STAGED_TOTAL_MB} MB.` };
    files.push({ filename: f.filename, media_type: f.media_type, kind: f.kind, file_base64: bytesToBase64(new Uint8Array(await obj.arrayBuffer())) });
  }
  // The magic-byte and size checks the inline path runs on arrival, run here on
  // the real bytes: the upload's Content-Type was only a claim.
  const check = checkFiles(files, { maxFileBytes: MAX_STAGED_TOTAL_BYTES, maxTotalBytes: MAX_STAGED_TOTAL_BYTES });
  if (check.error) return { error: check.error };
  return { files };
}

// Runs one claimed run to a terminal state. Never throws: every exit writes the
// row, because the row is all the poller and the sweeper can see.
export async function runClaimedV2(env, admin, claimed) {
  const job = claimed.job || {};
  const fail = async (detail) => {
    console.error(`[proof-scan-v2-job] ${claimed.id} failed:`, detail);
    try { await store.finishRun(admin, claimed.id, { status: 'error', error_detail: String(detail).slice(0, 1000) }); }
    catch (err) { console.error('[proof-scan-v2-job] could not record the failure:', err?.cause?.code || err.message); }
    return { status: 'error' };
  };

  try {
    const loaded = await loadStaged(env, job.files || []);
    if (loaded.error) return await fail(loaded.error);

    const body = {
      case_id: claimed.case_id, stage: claimed.stage,
      ...(claimed.scope ? { scope: claimed.scope } : {}),
      ...(job.form ? { form: job.form } : {}),
      files: loaded.files, email: Boolean(job.email),
    };
    // Again, against the case as it is now: evidence can change while a run waits.
    const prepared = await prepareRun(admin, body);
    if (prepared.response) {
      const { error } = await prepared.response.json();
      return await fail(error || 'The case is no longer ready for this review.');
    }
    const { prep } = prepared;

    const run = await executeRun(env, admin, { body, prep, files: loaded.files });
    // The files have been read; they are single-use (D-84).
    await dropStaged(env, job.files);
    if (!run.ok) return await fail(run.error);

    const stored = await store.finishRun(admin, claimed.id, {
      ...storedRunFields({ evaluation: run.evaluation, meta: run.meta, prep }),
      rule_set_version: prep.ruleSet.version,
      error_detail: null,
    });
    // The sweeper requeued it under us; the other runner owns the row now.
    if (!stored) return { status: 'superseded' };

    const { outcome } = await completeRun(env, admin, {
      runId: claimed.id, caseId: prep.snapshot.case.id, stage: claimed.stage,
      people: prep.snapshot.people, evaluation: run.evaluation, email: body.email,
    });
    await store.updateRunFields(admin, claimed.id, { job: { ...job, files: [], outcome } });
    return { status: 'structured' };
  } catch (err) {
    return fail(err?.isHttpError ? err.message : 'The review stopped unexpectedly. Please try again.');
  } finally {
    // Anything not already dropped above (an early failure) goes too; the
    // daily cron is the backstop for a runner that died outright.
    await dropStaged(env, job.files);
  }
}

// Claims and runs one run by id. Returns the status it got to, or null when it
// was not this caller's to run.
export async function processV2Run(env, admin, runId) {
  const claimed = await store.claimRun(admin, runId);
  if (!claimed) return null;
  await store.updateRunFields(admin, claimed.id, { attempts: (claimed.attempts ?? 0) + 1 });
  const { status } = await runClaimedV2(env, admin, { ...claimed, attempts: (claimed.attempts ?? 0) + 1 });
  return status;
}

// The 5-minute cron. Requeues or abandons stuck v2 runs, then starts the oldest
// run the fast path has left waiting. One per tick, like the live sweeper.
export async function runProofScanV2Sweep(env) {
  const admin = makeAdminClient(env);
  const now = Date.now();

  const { data: stuck } = await admin.from('proof_scans')
    .select('id, attempts, started_at')
    .eq('status', 'processing').not('case_id', 'is', null)
    .lt('started_at', new Date(now - STUCK_AFTER_MS).toISOString())
    .limit(5);
  for (const row of stuck || []) {
    const verdict = sweepVerdict(row, now);
    if (verdict === 'wait') continue;
    if (verdict === 'abandon') {
      console.warn(`[proof-scan-v2-job] ${row.id} abandoned after ${row.attempts} attempts`);
      await admin.from('proof_scans').update({
        status: 'error',
        error_detail: 'The review stopped partway through more than once. Add the files again and rerun.',
        completed_at: new Date().toISOString(),
      }).eq('id', row.id).eq('status', 'processing');
    } else {
      console.warn(`[proof-scan-v2-job] ${row.id} stuck in processing, requeueing`);
      await admin.from('proof_scans').update({ status: 'queued', started_at: null })
        .eq('id', row.id).eq('status', 'processing');
    }
  }

  const { data: waiting } = await admin.from('proof_scans')
    .select('id')
    .eq('status', 'queued').not('case_id', 'is', null)
    .lt('created_at', new Date(now - QUEUED_GRACE_MS).toISOString())
    .order('created_at', { ascending: true })
    .limit(1);
  const next = waiting?.[0];
  if (!next) return;
  console.log(`[proof-scan-v2-job] sweeper running ${next.id}`);
  await processV2Run(env, admin, next.id);
}
