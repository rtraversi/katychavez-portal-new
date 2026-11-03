// Ask Claude (2200_ai_chat.sql): the Worker routes, the stream assembler they
// depend on, and the migration's access rules.
//
// The send route is the one that matters: it must turn a stream into blocks
// that can be resent verbatim, keep a failed turn out of history, and never let
// one user reach another's chat or files.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const helpersMock = vi.hoisted(() => ({ verifyAuth: vi.fn(), makeAdminClient: vi.fn() }));
vi.mock('../../functions/api/_helpers.js', async (importOriginal) => ({
  ...(await importOriginal()),
  verifyAuth: helpersMock.verifyAuth,
  makeAdminClient: helpersMock.makeAdminClient,
}));

import { routes } from '../../_worker.js';
import { createFakeSupabase } from '../support/fake-supabase.js';
import { createMessageAssembler } from '../../functions/utils/anthropic-stream.js';
import {
  buildRequest, toApiMessages, titleFrom, addUsage, sniffMatches, estimateCost, systemPrompt,
  MAX_FILE_BYTES,
} from '../../functions/api/_ai-chat-common.js';
import { onRequest as send, apiErrorMessage } from '../../functions/api/ai-chat-send.js';
import { onRequest as upload, run as cleanup } from '../../functions/api/ai-chat-upload.js';
import { onRequest as conversation } from '../../functions/api/ai-chat-conversation.js';
import { onRequest as attachment } from '../../functions/api/ai-chat-attachment.js';
import { onRequest as stats } from '../../functions/api/ai-chat-stats.js';

const migration = Object.values(import.meta.glob('../../supabase/migrations/2200_ai_chat.sql', {
  query: '?raw', import: 'default', eager: true,
}))[0];

// ── Fixtures ─────────────────────────────────────────────────────────────────
const ME = 'user-me';
const OTHER = 'user-other';
const CONV = '11111111-1111-4111-8111-111111111111';
const OTHER_CONV = '22222222-2222-4222-8222-222222222222';
const ATT = '33333333-3333-4333-8333-333333333333';
const OTHER_ATT = '44444444-4444-4444-8444-444444444444';

const PDF = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<<>>\nendobj\ntrailer\n%%EOF\n');

function fakeR2(initial = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    async get(key) {
      if (!store.has(key)) return null;
      const bytes = store.get(key);
      return { body: new Blob([bytes]).stream(), arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) };
    },
    async put(key, bytes) { store.set(key, new Uint8Array(bytes)); },
    async delete(key) { store.delete(key); },
  };
}

let db;
let env;
let waits;
const ctx = { waitUntil: (p) => waits.push(p) };

beforeEach(() => {
  vi.clearAllMocks();
  db = createFakeSupabase();
  env = { ANTHROPIC_API_KEY: 'test-key', PORTAL_FIRM_NAME: 'Test Firm', R2: fakeR2() };
  waits = [];
  helpersMock.verifyAuth.mockResolvedValue({ admin: db, profile: { id: ME }, isClient: false, accessLevel: 'write' });
  helpersMock.makeAdminClient.mockReturnValue(db);
  globalThis.fetch = vi.fn(async () => { throw new Error('unexpected network call'); });
});

const sseLine = (type, payload) => `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;

// A streamed Messages API reply built from content blocks.
function sseReply(blocks, { stopReason = 'end_turn', usage = { input_tokens: 1200, output_tokens: 300 }, model = 'claude-opus-5-5' } = {}) {
  let s = sseLine('message_start', { message: { model, usage: { input_tokens: usage.input_tokens, output_tokens: 1 } } });
  blocks.forEach((b, index) => {
    if (b.type === 'text') {
      s += sseLine('content_block_start', { index, content_block: { type: 'text', text: '', citations: null } });
      for (const part of b.text.match(/.{1,7}/gs) || []) s += sseLine('content_block_delta', { index, delta: { type: 'text_delta', text: part } });
      for (const c of b.citations || []) s += sseLine('content_block_delta', { index, delta: { type: 'citations_delta', citation: c } });
    } else if (b.type === 'thinking') {
      s += sseLine('content_block_start', { index, content_block: { type: 'thinking', thinking: '', signature: '' } });
      s += sseLine('content_block_delta', { index, delta: { type: 'thinking_delta', thinking: b.thinking } });
      s += sseLine('content_block_delta', { index, delta: { type: 'signature_delta', signature: b.signature } });
    } else if (b.type === 'server_tool_use') {
      s += sseLine('content_block_start', { index, content_block: { type: 'server_tool_use', id: b.id, name: b.name, input: {} } });
      const json = JSON.stringify(b.input);
      s += sseLine('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: json.slice(0, 5) } });
      s += sseLine('content_block_delta', { index, delta: { type: 'input_json_delta', partial_json: json.slice(5) } });
    } else {
      s += sseLine('content_block_start', { index, content_block: b });
    }
    s += sseLine('content_block_stop', { index });
  });
  s += sseLine('message_delta', { delta: { stop_reason: stopReason }, usage: { output_tokens: usage.output_tokens, ...(usage.server_tool_use ? { server_tool_use: usage.server_tool_use } : {}) } });
  s += sseLine('message_stop', {});
  return new Response(s, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function sendRequest(body) {
  return new Request('https://portal.test/api/ai-chat-send', {
    method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer t' }, body: JSON.stringify(body),
  });
}

// Runs the send route to completion and returns its status, parsed events and
// (for JSON errors) its body.
async function ask(body) {
  const res = await send({ request: sendRequest(body), env, ctx });
  if (!(res.headers.get('content-type') || '').includes('ndjson')) return { status: res.status, body: await res.json(), events: [] };
  const text = new TextDecoder().decode(await res.arrayBuffer());
  await Promise.all(waits);
  return { status: res.status, events: text.trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) };
}

const sentBodies = () => globalThis.fetch.mock.calls.map(([, init]) => JSON.parse(init.body));

// ── The stream assembler ─────────────────────────────────────────────────────
describe('createMessageAssembler', () => {
  async function assemble(res) {
    const asm = createMessageAssembler();
    asm.push(await res.text());
    return asm;
  }

  it('rebuilds thinking (with signature), search and cited text blocks exactly', async () => {
    const cite = { type: 'web_search_result_location', url: 'https://www.uscis.gov/policy-manual', title: 'Policy Manual', cited_text: 'x', encrypted_index: 'e' };
    const asm = await assemble(sseReply([
      { type: 'thinking', thinking: 'Consider 9(C).', signature: 'sig-abc' },
      { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: '212(a)(9)(C) exception' } },
      { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: [{ type: 'web_search_result', url: 'https://www.uscis.gov', title: 'USCIS', encrypted_content: 'enc' }] },
      { type: 'text', text: 'The permanent bar applies.', citations: [cite] },
      { type: 'text', text: '\n\nPlain closing.' },
    ], { stopReason: 'end_turn' }));

    expect(asm.blocks()).toEqual([
      { type: 'thinking', thinking: 'Consider 9(C).', signature: 'sig-abc' },
      { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: '212(a)(9)(C) exception' } },
      { type: 'web_search_tool_result', tool_use_id: 'srv_1', content: [{ type: 'web_search_result', url: 'https://www.uscis.gov', title: 'USCIS', encrypted_content: 'enc' }] },
      { type: 'text', text: 'The permanent bar applies.', citations: [cite] },
      { type: 'text', text: '\n\nPlain closing.' },   // citations: null dropped
    ]);
    expect(asm.stopReason()).toBe('end_turn');
    expect(asm.model()).toBe('claude-opus-5-5');
    expect(asm.usage()).toMatchObject({ input_tokens: 1200, output_tokens: 300 });
  });

  // Seen live 2026-11-03: a web search started from code execution streams its
  // input whole in content_block_start, with no input_json_delta after it.
  it('keeps a tool input that arrives whole in content_block_start', () => {
    const asm = createMessageAssembler();
    asm.push(
      sseLine('content_block_start', { index: 0, content_block: { type: 'server_tool_use', id: 'srv_9', name: 'web_search', input: { query: 'I-130 fee G-1055' } } })
      + sseLine('content_block_stop', { index: 0 })
      + sseLine('content_block_start', { index: 1, content_block: { type: 'server_tool_use', id: 'srv_10', name: 'web_search', input: {} } })
      + sseLine('content_block_stop', { index: 1 }),
    );
    expect(asm.blocks()).toEqual([
      { type: 'server_tool_use', id: 'srv_9', name: 'web_search', input: { query: 'I-130 fee G-1055' } },
      { type: 'server_tool_use', id: 'srv_10', name: 'web_search', input: {} },
    ]);
  });

  it('survives events split at arbitrary chunk boundaries', async () => {
    const full = await sseReply([{ type: 'text', text: 'Split across many chunks.' }]).text();
    const asm = createMessageAssembler();
    for (let i = 0; i < full.length; i += 3) asm.push(full.slice(i, i + 3));
    expect(asm.blocks()).toEqual([{ type: 'text', text: 'Split across many chunks.' }]);
  });

  it('reports a stream error event', () => {
    const asm = createMessageAssembler();
    asm.push(sseLine('error', { error: { type: 'overloaded_error', message: 'Overloaded' } }));
    expect(asm.error()).toBe('Overloaded');
  });
});

// ── Shared helpers ───────────────────────────────────────────────────────────
describe('Ask Claude request building', () => {
  it('uses the research model (Opus 5.5) with adaptive summarized thinking and refusal fallback', () => {
    const { model, headers, body } = buildRequest(env, { system: 's', messages: [], webSearch: true });
    expect(model).toBe('claude-opus-5-5');
    expect(body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(body.output_config.effort).toBe('high');
    expect(body.stream).toBe(true);
    expect(body.fallbacks).toBe('default');
    expect(headers['anthropic-beta']).toBe('server-side-fallback-2026-07-01');
    expect(body.tool_choice).toBeUndefined();
  });

  it('keeps the web search tool declared and turns it off with tool_choice none', () => {
    const on = buildRequest(env, { system: 's', messages: [], webSearch: true }).body;
    const off = buildRequest(env, { system: 's', messages: [], webSearch: false }).body;
    expect(off.tools).toEqual(on.tools);
    expect(off.tools[0]).toMatchObject({ type: 'web_search_20260209', name: 'web_search' });
    expect(off.tool_choice).toEqual({ type: 'none' });
  });

  it('honors MODEL_RESEARCH and drops the fallback beta for models without it', () => {
    const { model, headers, body } = buildRequest({ ...env, MODEL_RESEARCH: 'claude-opus-4-8' }, { system: 's', messages: [], webSearch: true });
    expect(model).toBe('claude-opus-4-8');
    expect(body.fallbacks).toBeUndefined();
    expect(headers['anthropic-beta']).toBeUndefined();
  });

  it('tells Claude to keep client details out of search queries', () => {
    expect(systemPrompt(env, '2026-10-27')).toMatch(/NEVER put a client's name, A-number/);
    expect(systemPrompt(env, '2026-10-27')).toContain('Test Firm');
  });

  // The 2026-11-03 live runs came back with no API citations (searches run inside
  // code execution), so the Sources list stayed empty. Inline links are the backstop.
  it('tells Claude to link the pages it relies on, using only URLs its searches returned', () => {
    const p = systemPrompt(env, '2026-10-27');
    expect(p).toMatch(/Link every web page you rely on/);
    expect(p).toMatch(/never build or guess one/);
  });

  it('expands stored attachment refs into document and image blocks', () => {
    const rows = [
      { role: 'user', content: [{ type: 'attachment', attachment_id: 'a1' }, { type: 'attachment', attachment_id: 'a2' }, { type: 'attachment', attachment_id: 'gone' }, { type: 'text', text: 'Read these' }] },
      { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 's' }, { type: 'text', text: 'Done' }] },
    ];
    const files = new Map([
      ['a1', { file_name: 'rfe.pdf', content_type: 'application/pdf', base64: 'UERG' }],
      ['a2', { file_name: 'i94.png', content_type: 'image/png', base64: 'UE5H' }],
    ]);
    expect(toApiMessages(rows, files)).toEqual([
      { role: 'user', content: [
        { type: 'document', title: 'rfe.pdf', source: { type: 'base64', media_type: 'application/pdf', data: 'UERG' } },
        { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'UE5H' } },
        { type: 'text', text: '[An attached file is no longer available.]' },
        { type: 'text', text: 'Read these' },
      ] },
      rows[1],   // assistant content goes back untouched
    ]);
  });

  it('titles a chat from the first words of the question', () => {
    expect(titleFrom('  Short question  ')).toBe('Short question');
    const t = titleFrom('My client entered without inspection in 1994 and attempted re-entry in 1996 and 1999, what now?');
    expect(t.endsWith('…')).toBe(true);
    expect(t.length).toBeLessThanOrEqual(71);
  });

  it('sums usage across resumed calls, including web searches', () => {
    let u = addUsage({}, { input_tokens: 10, output_tokens: 5, server_tool_use: { web_search_requests: 2 } });
    u = addUsage(u, { input_tokens: 3, output_tokens: 4, cache_read_input_tokens: 100, server_tool_use: { web_search_requests: 1 } });
    expect(u).toEqual({ input_tokens: 13, output_tokens: 9, cache_read_input_tokens: 100, web_search_requests: 3 });
  });

  it('checks file signatures, not just the declared type', () => {
    expect(sniffMatches('application/pdf', PDF)).toBe(true);
    expect(sniffMatches('image/png', PDF)).toBe(false);
    expect(sniffMatches('text/html', PDF)).toBe(false);
  });

  it('estimates cost from Opus 5.5 rates', () => {
    expect(estimateCost({ model: 'claude-opus-5-5', input_tokens: 1_000_000, output_tokens: 100_000, web_searches: 10 })).toBeCloseTo(4 + 2 + 0.1, 5);
  });

  it('maps API errors to plain language', () => {
    expect(apiErrorMessage(529)).toMatch(/busy/);
    expect(apiErrorMessage(400, 'prompt is too long: 1200000 tokens')).toMatch(/too long/);
  });
});

// ── POST /api/ai-chat-send ───────────────────────────────────────────────────
describe('POST /api/ai-chat-send', () => {
  it('creates a chat, streams the answer, and saves both turns', async () => {
    globalThis.fetch.mockResolvedValueOnce(sseReply([
      { type: 'thinking', thinking: 'Weigh 9(B) vs 9(C).', signature: 'sig' },
      { type: 'text', text: 'Submit evidence of the 10-year period outside the U.S.' },
    ]));

    const { status, events } = await ask({ text: 'Entered 1994, attempted 1996 and 1999. I-212 evidence?' });
    expect(status).toBe(200);
    expect(events[0]).toMatchObject({ type: 'start', title: 'Entered 1994, attempted 1996 and 1999. I-212 evidence?' });
    expect(events.filter((e) => e.type === 'thinking').map((e) => e.text).join('')).toBe('Weigh 9(B) vs 9(C).');
    expect(events.filter((e) => e.type === 'text').map((e) => e.text).join('')).toBe('Submit evidence of the 10-year period outside the U.S.');
    const done = events.at(-1);
    expect(done.type).toBe('done');
    expect(done.message.content[0]).toEqual({ type: 'thinking', thinking: 'Weigh 9(B) vs 9(C).', signature: 'sig' });

    const convs = db.rows('ai_chat_conversations');
    expect(convs).toHaveLength(1);
    expect(convs[0]).toMatchObject({ user_id: ME, message_count: 2 });
    const msgs = db.rows('ai_chat_messages');
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(msgs[1]).toMatchObject({ model: 'claude-opus-5-5', stop_reason: 'end_turn', usage: { input_tokens: 1200, output_tokens: 300 } });

    const [reqBody] = sentBodies();
    expect(reqBody.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: 'Entered 1994, attempted 1996 and 1999. I-212 evidence?' }] }]);
    expect(reqBody.model).toBe('claude-opus-5-5');
  });

  it('resends the whole history, verbatim, on a follow-up', async () => {
    const prior = [{ type: 'thinking', thinking: 'x', signature: 'sig-1' }, { type: 'text', text: 'First answer' }];
    db.rows('ai_chat_conversations').push({ id: CONV, user_id: ME, title: 'Earlier', message_count: 2, updated_at: new Date().toISOString() });
    db.rows('ai_chat_messages').push(
      { id: 'm1', conversation_id: CONV, role: 'user', content: [{ type: 'text', text: 'First' }], created_at: '2026-10-01T00:00:00Z' },
      { id: 'm2', conversation_id: CONV, role: 'assistant', content: prior, created_at: '2026-10-01T00:00:01Z' },
    );
    globalThis.fetch.mockResolvedValueOnce(sseReply([{ type: 'text', text: 'Second answer' }]));

    const { events } = await ask({ conversation_id: CONV, text: 'Follow-up' });
    expect(events.at(-1).type).toBe('done');
    expect(sentBodies()[0].messages).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'First' }] },
      { role: 'assistant', content: prior },
      { role: 'user', content: [{ type: 'text', text: 'Follow-up' }] },
    ]);
    expect(db.rows('ai_chat_conversations')[0].message_count).toBe(4);
  });

  it('sends attached files from R2 as documents and links them to the chat', async () => {
    env.R2 = fakeR2({ 'ai-chat/user-me/a.pdf': PDF });
    db.rows('ai_chat_attachments').push({ id: ATT, user_id: ME, conversation_id: null, r2_key: 'ai-chat/user-me/a.pdf', file_name: 'rfe.pdf', content_type: 'application/pdf', size_bytes: PDF.length });
    globalThis.fetch.mockResolvedValueOnce(sseReply([{ type: 'text', text: 'The RFE asks for…' }]));

    const { events } = await ask({ text: 'Summarize this RFE', attachment_ids: [ATT] });
    expect(events.at(-1).type).toBe('done');
    const userContent = sentBodies()[0].messages[0].content;
    expect(userContent[0]).toMatchObject({ type: 'document', title: 'rfe.pdf', source: { type: 'base64', media_type: 'application/pdf' } });
    expect(atob(userContent[0].source.data)).toBe(new TextDecoder().decode(PDF));
    expect(db.rows('ai_chat_attachments')[0].conversation_id).toBe(db.rows('ai_chat_conversations')[0].id);
    // The database keeps a pointer, never the bytes.
    expect(db.rows('ai_chat_messages')[0].content[0]).toEqual({ type: 'attachment', attachment_id: ATT });
  });

  it('rolls the whole turn back when the API refuses the request outright', async () => {
    globalThis.fetch.mockResolvedValueOnce(new Response('{"error":{"type":"overloaded_error"}}', { status: 529 }));
    const { status, body } = await ask({ text: 'Question' });
    expect(status).toBe(503);
    expect(body.error).toMatch(/busy/);
    expect(db.rows('ai_chat_messages')).toEqual([]);
    expect(db.rows('ai_chat_conversations')).toEqual([]);
  });

  it('rolls back and reports when Claude declines', async () => {
    globalThis.fetch.mockResolvedValueOnce(sseReply([{ type: 'text', text: '' }], { stopReason: 'refusal' }));
    const { events } = await ask({ text: 'Question' });
    expect(events.at(-1)).toMatchObject({ type: 'error', error: expect.stringMatching(/declined/) });
    expect(db.rows('ai_chat_messages')).toEqual([]);
    expect(db.rows('ai_chat_conversations')).toEqual([]);
  });

  it('keeps an existing chat but drops the failed question when the stream errors', async () => {
    db.rows('ai_chat_conversations').push({ id: CONV, user_id: ME, title: 'Earlier', message_count: 0, updated_at: new Date().toISOString() });
    const res = new Response(sseLine('message_start', { message: { model: 'claude-opus-5-5', usage: {} } }) + sseLine('error', { error: { message: 'Overloaded' } }), { status: 200 });
    globalThis.fetch.mockResolvedValueOnce(res);
    const { events } = await ask({ conversation_id: CONV, text: 'Question' });
    expect(events.at(-1).type).toBe('error');
    expect(db.rows('ai_chat_conversations')).toHaveLength(1);
    expect(db.rows('ai_chat_messages')).toEqual([]);
  });

  it('detaches files from a rolled-back new chat so the retry can reuse them', async () => {
    env.R2 = fakeR2({ k: PDF });
    db.rows('ai_chat_attachments').push({ id: ATT, user_id: ME, conversation_id: null, r2_key: 'k', file_name: 'a.pdf', content_type: 'application/pdf', size_bytes: PDF.length });
    globalThis.fetch.mockResolvedValueOnce(new Response('bad', { status: 500 }));
    await ask({ text: 'Question', attachment_ids: [ATT] });
    expect(db.rows('ai_chat_attachments')).toHaveLength(1);
    expect(db.rows('ai_chat_attachments')[0].conversation_id).toBeNull();
    expect(env.R2.store.has('k')).toBe(true);
  });

  it('resumes after pause_turn and saves one combined reply', async () => {
    const search = { type: 'server_tool_use', id: 'srv_1', name: 'web_search', input: { query: 'I-212 filing fee' } };
    globalThis.fetch
      .mockResolvedValueOnce(sseReply([search], { stopReason: 'pause_turn', usage: { input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: 1 } } }))
      .mockResolvedValueOnce(sseReply([{ type: 'text', text: 'The fee is listed on the G-1055.' }], { usage: { input_tokens: 200, output_tokens: 20 } }));

    const { events } = await ask({ text: 'Current I-212 fee?' });
    expect(events.find((e) => e.type === 'search')).toEqual({ type: 'search', query: 'I-212 filing fee' });
    expect(events.at(-1).type).toBe('done');

    const [, second] = sentBodies();
    expect(second.messages.at(-1)).toEqual({ role: 'assistant', content: [search] });
    const saved = db.rows('ai_chat_messages')[1];
    expect(saved.content.map((b) => b.type)).toEqual(['server_tool_use', 'text']);
    expect(saved.usage).toEqual({ input_tokens: 300, output_tokens: 30, web_search_requests: 1 });
  });

  it('sends tool_choice none when the user turned web search off', async () => {
    globalThis.fetch.mockResolvedValueOnce(sseReply([{ type: 'text', text: 'ok' }]));
    await ask({ text: 'Question', web_search: false });
    expect(sentBodies()[0].tool_choice).toEqual({ type: 'none' });
  });

  it("refuses another user's chat", async () => {
    db.rows('ai_chat_conversations').push({ id: OTHER_CONV, user_id: OTHER, title: 'Theirs', message_count: 2 });
    const { status } = await ask({ conversation_id: OTHER_CONV, text: 'Peek' });
    expect(status).toBe(404);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });

  it("refuses another user's file and leaves no empty chat behind", async () => {
    db.rows('ai_chat_attachments').push({ id: OTHER_ATT, user_id: OTHER, conversation_id: null, r2_key: 'x', file_name: 'x.pdf', content_type: 'application/pdf', size_bytes: 10 });
    const { status } = await ask({ text: 'Read this', attachment_ids: [OTHER_ATT] });
    expect(status).toBe(400);
    expect(db.rows('ai_chat_conversations')).toEqual([]);
    expect(db.rows('ai_chat_attachments')[0].conversation_id).toBeNull();
  });

  it('enforces the daily reply cap', async () => {
    env.AI_CHAT_DAILY_LIMIT = '2';
    const now = new Date().toISOString();
    db.rows('ai_chat_conversations').push({ id: CONV, user_id: ME, title: 't', message_count: 4, updated_at: now });
    db.rows('ai_chat_messages').push(
      { id: 'a', conversation_id: CONV, role: 'assistant', content: [], created_at: now },
      { id: 'b', conversation_id: CONV, role: 'assistant', content: [], created_at: now },
    );
    const { status, body } = await ask({ text: 'One more' });
    expect(status).toBe(429);
    expect(body.error).toMatch(/limit of 2/);
  });

  it('validates the request before touching anything', async () => {
    expect((await ask({ text: '   ' })).status).toBe(400);
    expect((await ask({ text: 'x'.repeat(60_001) })).status).toBe(400);
    expect((await ask({ text: 'q', conversation_id: 'not-a-uuid' })).status).toBe(400);
    expect((await ask({ text: 'q', attachment_ids: ['nope'] })).status).toBe(400);
    expect(db.log.filter((e) => e.op !== 'select')).toEqual([]);
  });

  it('answers 503 when the portal has no API key', async () => {
    delete env.ANTHROPIC_API_KEY;
    expect((await ask({ text: 'q' })).status).toBe(503);
  });
});

// ── Access on every route ────────────────────────────────────────────────────
describe('Ask Claude route access', () => {
  const AI_ROUTES = Object.entries(routes).filter(([path]) => path.startsWith('/api/ai-chat-'));

  it('registers all five routes', () => {
    expect(AI_ROUTES.map(([p]) => p).sort()).toEqual([
      '/api/ai-chat-attachment', '/api/ai-chat-conversation', '/api/ai-chat-send', '/api/ai-chat-stats', '/api/ai-chat-upload',
    ]);
  });

  for (const [label, verdict, expected] of [
    ['no login', { httpError: { status: 401, message: 'Unauthorized' } }, 401],
    ['a role without ai_chat (e.g. Client)', { httpError: { status: 403, message: 'Insufficient permissions for ai_chat module' } }, 403],
  ]) {
    it(`refuses ${label} on every route, and writes nothing`, async () => {
      helpersMock.verifyAuth.mockResolvedValue(verdict);
      for (const [path, handler] of AI_ROUTES) {
        const seen = [];
        for (const method of ['GET', 'POST']) {
          const req = new Request(`https://portal.test${path}?id=${ATT}`, {
            method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? '{}' : undefined,
          });
          seen.push((await handler({ request: req, env, ctx })).status);
        }
        expect(seen, path).toContain(expected);
        for (const s of seen) expect([expected, 405], path).toContain(s);
      }
      expect(db.log.filter((e) => e.op !== 'select')).toEqual([]);
    });
  }

  it('asks for admin on the stats route and write on the others', async () => {
    helpersMock.verifyAuth.mockResolvedValue({ httpError: { status: 403, message: 'no' } });
    const levels = {};
    for (const [path, handler] of AI_ROUTES) {
      const method = path.endsWith('stats') || path.endsWith('attachment') ? 'GET' : 'POST';
      await handler({ request: new Request(`https://portal.test${path}`, { method, body: method === 'POST' ? '{}' : undefined }), env, ctx });
      const [, , level, moduleKey] = helpersMock.verifyAuth.mock.calls.at(-1);
      levels[path] = `${level}:${moduleKey}`;
    }
    expect(levels).toEqual({
      '/api/ai-chat-send': 'write:ai_chat',
      '/api/ai-chat-upload': 'write:ai_chat',
      '/api/ai-chat-conversation': 'write:ai_chat',
      '/api/ai-chat-attachment': 'read:ai_chat',
      '/api/ai-chat-stats': 'admin:ai_chat',
    });
  });
});

// ── Uploads, files, chats, stats ─────────────────────────────────────────────
describe('POST /api/ai-chat-upload', () => {
  const up = (bytes, type, name = 'notice.pdf') => upload({
    request: new Request('https://portal.test/api/ai-chat-upload', {
      method: 'POST', headers: { 'content-type': type, 'x-file-name': encodeURIComponent(name) }, body: bytes,
    }),
    env, ctx,
  });

  it('stores the file in R2 under the user and records a pointer', async () => {
    const res = await up(PDF, 'application/pdf', 'Notice of Intent.pdf');
    expect(res.status).toBe(200);
    const { attachment: att } = await res.json();
    expect(att).toMatchObject({ file_name: 'Notice of Intent.pdf', content_type: 'application/pdf', size_bytes: PDF.length });
    const row = db.rows('ai_chat_attachments')[0];
    expect(row.user_id).toBe(ME);
    expect(row.conversation_id).toBeNull();
    expect(row.r2_key).toMatch(/^ai-chat\/user-me\/[0-9a-f-]{36}\.pdf$/);
    expect(env.R2.store.get(row.r2_key)).toEqual(PDF);
  });

  it('rejects other types, mislabeled files and oversize files', async () => {
    expect((await up(PDF, 'text/html')).status).toBe(415);
    expect((await up(PDF, 'image/png')).status).toBe(415);
    expect((await up(new Uint8Array(MAX_FILE_BYTES + 1).fill(0x25), 'application/pdf')).status).toBe(413);
    expect(db.rows('ai_chat_attachments')).toEqual([]);
    expect(env.R2.store.size).toBe(0);
  });

  it('daily cleanup removes files never sent, and only those past a day', async () => {
    env.R2 = fakeR2({ old: PDF, fresh: PDF, sent: PDF });
    const dayAgo = new Date(Date.now() - 25 * 3600 * 1000).toISOString();
    db.rows('ai_chat_attachments').push(
      { id: 'old', user_id: ME, conversation_id: null, r2_key: 'old', created_at: dayAgo },
      { id: 'fresh', user_id: ME, conversation_id: null, r2_key: 'fresh', created_at: new Date().toISOString() },
      { id: 'sent', user_id: ME, conversation_id: CONV, r2_key: 'sent', created_at: dayAgo },
    );
    await cleanup(env);
    expect(db.rows('ai_chat_attachments').map((a) => a.id)).toEqual(['fresh', 'sent']);
    expect([...env.R2.store.keys()]).toEqual(['fresh', 'sent']);
  });
});

describe('POST /api/ai-chat-conversation', () => {
  const act = (body) => conversation({
    request: new Request('https://portal.test/api/ai-chat-conversation', { method: 'POST', body: JSON.stringify(body) }), env, ctx,
  });

  beforeEach(() => {
    env.R2 = fakeR2({ k1: PDF, k2: PDF });
    db.rows('ai_chat_conversations').push(
      { id: CONV, user_id: ME, title: 'Mine', message_count: 2 },
      { id: OTHER_CONV, user_id: OTHER, title: 'Theirs', message_count: 2 },
    );
    db.rows('ai_chat_attachments').push(
      { id: ATT, user_id: ME, conversation_id: CONV, r2_key: 'k1' },
      { id: OTHER_ATT, user_id: OTHER, conversation_id: OTHER_CONV, r2_key: 'k2' },
    );
  });

  it('renames your chat', async () => {
    const res = await act({ action: 'rename', id: CONV, title: '  I-212   for R.M.  ' });
    expect(res.status).toBe(200);
    expect(db.rows('ai_chat_conversations')[0].title).toBe('I-212 for R.M.');
  });

  it('deletes your chat and its files from R2', async () => {
    expect((await act({ action: 'delete', id: CONV })).status).toBe(200);
    expect(db.rows('ai_chat_conversations').map((c) => c.id)).toEqual([OTHER_CONV]);
    expect([...env.R2.store.keys()]).toEqual(['k2']);
  });

  it("won't touch another user's chat", async () => {
    expect((await act({ action: 'delete', id: OTHER_CONV })).status).toBe(404);
    expect((await act({ action: 'rename', id: OTHER_CONV, title: 'x' })).status).toBe(404);
    expect(db.rows('ai_chat_conversations')).toHaveLength(2);
    expect(env.R2.store.size).toBe(2);
  });
});

describe('GET /api/ai-chat-attachment', () => {
  it("serves your own file and 404s someone else's", async () => {
    env.R2 = fakeR2({ k1: PDF, k2: PDF });
    db.rows('ai_chat_attachments').push(
      { id: ATT, user_id: ME, r2_key: 'k1', file_name: 'rfe.pdf', content_type: 'application/pdf' },
      { id: OTHER_ATT, user_id: OTHER, r2_key: 'k2', file_name: 'x.pdf', content_type: 'application/pdf' },
    );
    const get = (id) => attachment({ request: new Request(`https://portal.test/api/ai-chat-attachment?id=${id}`), env, ctx });
    const mine = await get(ATT);
    expect(mine.status).toBe(200);
    expect(mine.headers.get('content-type')).toBe('application/pdf');
    expect(new Uint8Array(await mine.arrayBuffer())).toEqual(PDF);
    expect((await get(OTHER_ATT)).status).toBe(404);
  });
});

describe('GET /api/ai-chat-stats', () => {
  it('prices usage by month for the admin panel', async () => {
    db.rpc = vi.fn(async () => ({ data: {
      conversations: 3, messages: 12, attachments: 1, attachment_bytes: 2048, table_bytes: 98304, database_bytes: 50_000_000, users: 2,
      usage: [
        { month: '2026-10', model: 'claude-opus-5-5', replies: 6, input_tokens: 500_000, output_tokens: 50_000, cache_write_tokens: 0, cache_read_tokens: 0, web_searches: 4 },
        { month: '2026-09', model: 'claude-opus-5-5', replies: 1, input_tokens: 0, output_tokens: 0, cache_write_tokens: 0, cache_read_tokens: 0, web_searches: 0 },
      ],
    }, error: null }));
    const res = await stats({ request: new Request('https://portal.test/api/ai-chat-stats'), env, ctx });
    expect(db.rpc).toHaveBeenCalledWith('ai_chat_storage_stats');
    const body = await res.json();
    expect(body.months[0]).toEqual({ month: '2026-10', replies: 6, web_searches: 4, estimated_cost: 3.04 });
    expect(body.table_bytes).toBe(98304);
  });
});

// ── Migration ────────────────────────────────────────────────────────────────
describe('2200_ai_chat.sql', () => {
  const TABLES = ['ai_chat_conversations', 'ai_chat_messages', 'ai_chat_attachments'];

  it('enables RLS on every new table and limits reads to the owner', () => {
    for (const t of TABLES) expect(migration).toMatch(new RegExp(`ALTER TABLE public\\.${t}\\s+ENABLE ROW LEVEL SECURITY`));
    expect(migration).toMatch(/user_id = public\.my_user_id\(\)/);
  });

  it('grants the Data API explicitly: SELECT for staff, writes for the service role only', () => {
    const grantSelect = migration.match(/GRANT SELECT ON ([^;]+) TO authenticated;/);
    const grantAll = migration.match(/GRANT SELECT, INSERT, UPDATE, DELETE\s+ON ([^;]+?)\s+TO service_role;/);
    for (const t of TABLES) {
      expect(grantSelect[1]).toContain(t);
      expect(grantAll[1]).toContain(t);
    }
    expect(migration).not.toMatch(/GRANT (INSERT|UPDATE|DELETE)[^;]*TO authenticated/);
  });

  it('keeps the stats function off the public API', () => {
    expect(migration).toMatch(/REVOKE ALL ON FUNCTION public\.ai_chat_storage_stats\(\) FROM PUBLIC, anon, authenticated;/);
    expect(migration).toMatch(/GRANT EXECUTE ON FUNCTION public\.ai_chat_storage_stats\(\) TO service_role;/);
  });
});
