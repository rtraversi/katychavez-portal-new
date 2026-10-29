// _ai-chat-common.js: what every Ask Claude route shares. NOT a route.
//
// Ask Claude is the staff research chat (2200_ai_chat.sql). It exists so client
// facts can go to Claude under the firm's commercial API terms instead of a
// consumer plan, so the rules here lean toward keeping those facts in-house:
// web search queries must stay generic, files stay in R2, and every turn is
// stored verbatim in the firm's own database.

import { modelFor } from './_models.js';

export const API_URL = 'https://api.anthropic.com/v1/messages';

// ── Limits ───────────────────────────────────────────────────────────────────
// Every earlier file in a chat is resent (base64, so +33%) with each new
// question. The Messages API caps a request at 32 MB, but the tighter limit is
// the Worker's 128 MB of memory: the base64 strings and the JSON body built
// from them are both held at once. 15 MB of originals per chat keeps that peak
// well under the ceiling.
export const MAX_FILE_BYTES          = 10 * 1024 * 1024;
export const MAX_CHAT_FILE_BYTES     = 15 * 1024 * 1024;
export const MAX_FILES_PER_MESSAGE   = 5;
export const MAX_TEXT_CHARS          = 60_000;   // a pasted declaration or RFE fits
export const MAX_MESSAGES            = 200;      // user + assistant rows per chat
export const MAX_CONTINUATIONS       = 4;        // pause_turn resumes in one reply
export const WEB_SEARCH_MAX_USES     = 5;        // searches per API call
export const DEFAULT_DAILY_LIMIT     = 150;      // replies per user per rolling day; AI_CHAT_DAILY_LIMIT overrides
export const UNSENT_ATTACHMENT_HOURS = 24;       // the daily cron clears files never sent

export const FILE_TYPES = {
  'application/pdf': { ext: 'pdf',  block: 'document' },
  'image/png':       { ext: 'png',  block: 'image' },
  'image/jpeg':      { ext: 'jpg',  block: 'image' },
  'image/gif':       { ext: 'gif',  block: 'image' },
  'image/webp':      { ext: 'webp', block: 'image' },
};

// Leading bytes for each accepted type. The browser's Content-Type is only a
// claim; a mislabeled file would otherwise reach the API and fail the whole turn.
const MAGIC = {
  'application/pdf': [[0x25, 0x50, 0x44, 0x46]],                       // %PDF
  'image/png':       [[0x89, 0x50, 0x4e, 0x47]],
  'image/jpeg':      [[0xff, 0xd8, 0xff]],
  'image/gif':       [[0x47, 0x49, 0x46, 0x38]],                       // GIF8
  'image/webp':      [[0x52, 0x49, 0x46, 0x46]],                       // RIFF (WEBP at 8)
};

export function sniffMatches(contentType, bytes) {
  const sigs = MAGIC[contentType];
  if (!sigs) return false;
  const ok = sigs.some((sig) => sig.every((b, i) => bytes[i] === b));
  if (!ok) return false;
  if (contentType === 'image/webp') return String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  return true;
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function dailyLimit(env) {
  const n = Number.parseInt(env?.AI_CHAT_DAILY_LIMIT, 10);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_LIMIT;
}

// ── Instructions ─────────────────────────────────────────────────────────────
// Kept byte-stable within a day (only the date moves) so the prompt cache holds
// across a conversation's turns.
export function systemPrompt(env, today) {
  const firm = env?.PORTAL_FIRM_NAME || 'the firm';
  return `You are Claude, working as a research assistant for the attorneys and staff of ${firm}, a U.S. immigration law practice. Today is ${today}.

The people writing to you are legal professionals. Their questions often include real client facts: names, dates of entry and departure, immigration history, criminal history, family relationships. That is expected and appropriate here; this chat runs under the firm's commercial agreement. Treat everything in the conversation as confidential client information.

How to answer:
- Answer as an experienced immigration practitioner would brief a colleague. Lead with the answer, then the reasoning.
- Ground the analysis in the INA, 8 CFR, the USCIS Policy Manual, the Foreign Affairs Manual, and BIA, AG and federal court decisions, and cite the specific section or decision when you rely on one.
- Never invent a citation, case name, form number, fee, or processing time. If you are not sure a source says what you remember, say so, or check it with web search when that is available.
- Point out facts that would change the analysis and that the question leaves open, and say how each answer would change it.
- Separate settled rules from judgment calls and from strategy.
- For evidence questions, give a concrete, organized list of documents, and note which are essential and which only strengthen the case.
- Use Markdown: short headings and lists where they help, plain paragraphs where they don't. Be complete but not padded.

Web search, when it is enabled:
- Use it for anything that changes: current USCIS policy, form editions, filing fees, processing times, recent precedent decisions, and agency announcements.
- Prefer primary sources: uscis.gov, state.gov, travel.state.gov, justice.gov/eoir, ecfr.gov, federalregister.gov, and court opinions.
- A search query leaves the firm. NEVER put a client's name, A-number, receipt number, date of birth, address, phone number, or any other identifying detail in a search query. Search only for general legal terms, such as "212(a)(9)(C) permanent bar exception" or "I-601 extreme hardship evidence Policy Manual".

You are assisting a lawyer, who makes the final call. Do not add disclaimers that you are not a lawyer or that they should consult an attorney.`;
}

// America/Chicago is the firm's calendar day (the same one Card Income uses).
export function todayInFirmZone(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(now);
}

// ── Requests ─────────────────────────────────────────────────────────────────
// Models that accept server-side refusal fallback (same set as Proof Scan v2).
// A safety-classifier false positive on, say, a criminal-history question then
// reroutes inside the same call instead of failing the turn. A portal pinning
// MODEL_RESEARCH to something older gets the plain request.
const FALLBACK_MODELS = new Set(['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-opus-5', 'claude-fable-5-1']);
const FALLBACK_BETA = 'server-side-fallback-2026-07-01';

// The web search tool is declared on every request, and turned off with
// tool_choice "none" instead of being left out. A chat that searched earlier
// carries server_tool_use blocks in its history, and keeping `tools` identical
// from turn to turn keeps the cached prefix valid.
export function buildRequest(env, { system, messages, webSearch }) {
  const model = modelFor('research', env);
  const headers = {
    'x-api-key': env.ANTHROPIC_API_KEY,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  };
  const body = {
    model,
    max_tokens: 64000,
    stream: true,
    system,
    messages,
    // Opus 5.5 always thinks; "summarized" returns a readable summary the page
    // shows while the answer is being worked out, instead of a silent pause.
    thinking: { type: 'adaptive', display: 'summarized' },
    output_config: { effort: env.AI_CHAT_EFFORT || 'high' },
    // Caches the whole prefix through the newest message, so each follow-up
    // pays full price only for what is new.
    cache_control: { type: 'ephemeral' },
    tools: [{ type: 'web_search_20260209', name: 'web_search', max_uses: WEB_SEARCH_MAX_USES }],
  };
  if (!webSearch) body.tool_choice = { type: 'none' };
  if (FALLBACK_MODELS.has(model)) {
    headers['anthropic-beta'] = FALLBACK_BETA;
    body.fallbacks = 'default';
  }
  return { model, headers, body };
}

// ── History ──────────────────────────────────────────────────────────────────
// Stored rows → API messages. A user turn keeps its files as
// {type:'attachment', attachment_id}; `files` maps those ids to
// { file_name, content_type, base64 }, read from R2 by the caller. Assistant
// content goes back exactly as stored.
export function toApiMessages(rows, files) {
  return rows.map((row) => {
    if (row.role === 'assistant') return { role: 'assistant', content: row.content };
    const content = row.content.map((block) => {
      if (block.type !== 'attachment') return block;
      const f = files.get(block.attachment_id);
      if (!f) return { type: 'text', text: '[An attached file is no longer available.]' };
      const kind = FILE_TYPES[f.content_type]?.block;
      if (kind === 'document') {
        return { type: 'document', title: f.file_name, source: { type: 'base64', media_type: f.content_type, data: f.base64 } };
      }
      return { type: 'image', source: { type: 'base64', media_type: f.content_type, data: f.base64 } };
    });
    return { role: 'user', content };
  });
}

export function attachmentIdsIn(rows) {
  const ids = new Set();
  for (const row of rows) {
    if (row.role !== 'user') continue;
    for (const b of row.content) if (b.type === 'attachment') ids.add(b.attachment_id);
  }
  return ids;
}

export function toBase64(bytes) {
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

// First words of the first question, cut at a word boundary.
export function titleFrom(text) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  if (!clean) return 'New chat';
  if (clean.length <= 70) return clean;
  const cut = clean.slice(0, 70);
  const space = cut.lastIndexOf(' ');
  return `${(space > 40 ? cut.slice(0, space) : cut).replace(/[\s,.;:–—-]+$/, '')}…`;
}

// Sums one API call's usage into the turn's running total. A reply that
// resumed after pause_turn is several calls; the row records them all.
export function addUsage(total, u) {
  const out = { ...total };
  for (const k of ['input_tokens', 'output_tokens', 'cache_creation_input_tokens', 'cache_read_input_tokens']) {
    if (typeof u?.[k] === 'number') out[k] = (out[k] || 0) + u[k];
  }
  const searches = u?.server_tool_use?.web_search_requests;
  if (typeof searches === 'number') out.web_search_requests = (out.web_search_requests || 0) + searches;
  return out;
}

// ── Cost estimate ────────────────────────────────────────────────────────────
// USD per million tokens, from Anthropic's price list (2026-10). The admin
// panel labels the total an estimate: fallback turns bill at the fallback
// model's rates and are recorded under the model that answered.
export const PRICES = {
  'claude-opus-5-5':   { input: 4,  output: 20, cacheWrite: 5,     cacheRead: 0.20 },
  'claude-opus-5':     { input: 5,  output: 25, cacheWrite: 6.25,  cacheRead: 0.50 },
  'claude-sonnet-5-5': { input: 2,  output: 10, cacheWrite: 2.50,  cacheRead: 0.20 },
  'claude-fable-5-1':  { input: 10, output: 50, cacheWrite: 12.50, cacheRead: 0.25 },
};
export const WEB_SEARCH_PRICE = 10 / 1000;   // USD per search

export function estimateCost(row) {
  const p = PRICES[row.model] || PRICES['claude-opus-5-5'];
  const m = 1_000_000;
  return (Number(row.input_tokens || 0) * p.input
    + Number(row.output_tokens || 0) * p.output
    + Number(row.cache_write_tokens || 0) * p.cacheWrite
    + Number(row.cache_read_tokens || 0) * p.cacheRead) / m
    + Number(row.web_searches || 0) * WEB_SEARCH_PRICE;
}
