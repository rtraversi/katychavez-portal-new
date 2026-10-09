// proof-scan-v2-process.js: runs one queued Proof Scan v2 stage run.
//   POST { run_id }
//
// The page fires this right after queueing a staged run and does not wait on
// it; it polls GET /api/proof-scan-v2-run?id= instead. This request stays open
// for the whole model call, which is what starts the run now rather than on the
// next cron tick, but nothing depends on it finishing: if the tab closes and
// takes this request with it, the sweeper picks the run up
// (_proof-scan-v2-job.js). A second call for the same run finds nothing to
// claim and reports where the run got to.

import { z } from 'zod';
import { requireStaff, readJson, json, guarded, methodNotAllowed } from './_proof-scan-v2-http.js';
import * as store from './_proof-scan-v2-store.js';
import { processV2Run } from './_proof-scan-v2-job.js';

const Body = z.object({ run_id: z.string().uuid() }).strict();

export const onRequest = guarded('proof-scan-v2-process', async ({ request, env }) => {
  if (request.method !== 'POST') return methodNotAllowed();
  const gate = await requireStaff(request, env, 'write');
  if (gate.response) return gate.response;
  const parsed = await readJson(request);
  if (parsed.response) return parsed.response;
  const v = Body.safeParse(parsed.body);
  if (!v.success) return json(400, { error: 'run_id must be a run id' });

  const status = await processV2Run(env, gate.admin, v.data.run_id);
  if (status) return json(200, { status });

  // Not ours to run: it does not exist, is not a v2 run, or another runner has it.
  const run = await store.getRun(gate.admin, v.data.run_id);
  if (!run || !run.case_id) return json(404, { error: 'Run not found' });
  return json(200, { status: run.status });
});
