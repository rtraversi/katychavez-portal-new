// functions/api/_models.js — the two things every Claude call site needs:
// which model to use, and how to read what comes back.
//
// Call sites name the JOB, not the model: `modelFor('judge', env)`, not a pinned
// string. Before this existed the model id was hardcoded at six call sites, so
// changing one meant six edits and a deploy — per client portal — and they had
// silently drifted a generation behind.
//
// Roles, not tiers. A role describes what the call is FOR, so the mapping can be
// re-tuned centrally as models change without every caller having an opinion:
//
//   chat     conversational assistant; latency matters more than depth
//   extract  cheap structured pulls from a document (classify, entities)
//   reason   document work needing real comprehension (translate, route pages)
//   judge    high-stakes review where a miss costs a USCIS rejection and a false
//            positive wastes paralegal time
//
// Per-client override without a code change: set MODEL_CHAT / MODEL_EXTRACT /
// MODEL_REASON / MODEL_JUDGE as a Worker var in that client's wrangler.toml.
// Use it to pin a portal to a known-good model, or to try a new one on the
// sandbox before it becomes everyone's default here.
//
// Verify an id against the account before pinning it — `GET /v1/models` lists
// what the org can actually reach. Note Haiku 4.5 publishes ONLY as the dated
// id below; there is no undated alias for it, unlike the 5-family.

const MODELS = {
  chat:    'claude-haiku-4-5-20251001',
  extract: 'claude-haiku-4-5-20251001',
  reason:  'claude-sonnet-5',
  // Opus, because the judge workload (proof scan) is the one place where a miss
  // is a USCIS rejection and a false positive burns paralegal time. This was
  // pinned to Sonnet only while the scan was a synchronous request that Opus
  // plus thinking could push past Cloudflare's edge timeout; the scan is a
  // queued job now (PROOF-SCAN-HANDOFF.md §12 step 4), so nothing is waiting on
  // it and the stronger model is simply better.
  judge:   'claude-opus-5',
};

const ENV_OVERRIDE = {
  chat:    'MODEL_CHAT',
  extract: 'MODEL_EXTRACT',
  reason:  'MODEL_REASON',
  judge:   'MODEL_JUDGE',
};

// Returns the model id for a role. Unknown roles throw rather than defaulting —
// a typo should fail loudly at the call site, not silently route to the wrong
// tier and show up later as a quality or cost surprise.
export function modelFor(role, env) {
  const fallback = MODELS[role];
  if (!fallback) throw new Error(`Unknown model role "${role}"`);
  const override = env?.[ENV_OVERRIDE[role]];
  return (typeof override === 'string' && override.trim()) || fallback;
}

// ── Reading a response ────────────────────────────────────────────────────────
// Returns the first text block of a Messages response, or ''.
//
// NEVER index content[0] directly. Current models run adaptive thinking when the
// `thinking` parameter is omitted — Sonnet 5 and Opus 5 both do, where Sonnet 4.6
// did not — and then content[0] is a `thinking` block, not text. Every call site
// here used to assume index 0, so bumping a model would have silently returned
// empty strings across five features at once.
export function textFrom(message) {
  const blocks = message?.content;
  if (!Array.isArray(blocks)) return '';
  return blocks.find(b => b?.type === 'text')?.text || '';
}

export { MODELS, ENV_OVERRIDE };
