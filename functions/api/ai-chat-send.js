// POST /api/ai-chat-send: ask Claude one question in an Ask Claude chat.
//
// Body: { conversation_id?: uuid, text: string, attachment_ids?: uuid[], web_search?: boolean }
// Auth: staff with write on ai_chat. A chat belongs to the user who started it.
//
// Answers with a stream of newline-delimited JSON events:
//   {type:'start',    conversation_id, title}
//   {type:'thinking', text}          reasoning summary, as it is written
//   {type:'search',   query}         a web search Claude just ran
//   {type:'text',     text}          the answer, as it is written
//   {type:'done',     message}       the saved assistant row; render from this
//   {type:'error',    error}         the turn failed and was rolled back
//   {type:'ping'}
// Failures before the model starts answering come back as plain JSON errors.
//
// The turn is all-or-nothing. The question is saved first; if the reply fails
// or is refused, the question is deleted again (and a chat created for it), so
// history never holds a half-turn and the page can put the text back in the box
// for a retry. Saving runs under waitUntil, so closing the tab mid-answer
// still keeps the finished reply.

import { verifyAuth, json } from './_helpers.js';
import { createMessageAssembler } from '../utils/anthropic-stream.js';
import {
  API_URL, MAX_CHAT_FILE_BYTES, MAX_FILES_PER_MESSAGE, MAX_TEXT_CHARS, MAX_MESSAGES,
  MAX_CONTINUATIONS, UUID_RE, dailyLimit, systemPrompt, todayInFirmZone, buildRequest,
  toApiMessages, attachmentIdsIn, toBase64, titleFrom, addUsage,
} from './_ai-chat-common.js';

export async function onRequest({ request, env, ctx }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'ai_chat');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  if (auth.isClient) return json(403, { error: 'Not available' });

  if (!env.ANTHROPIC_API_KEY) {
    console.warn('[ai-chat-send] ANTHROPIC_API_KEY not configured');
    return json(503, { error: 'Ask Claude is not configured on this portal.' });
  }

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const text = typeof body?.text === 'string' ? body.text.trim() : '';
  const attachmentIds = Array.isArray(body?.attachment_ids) ? [...new Set(body.attachment_ids)] : [];
  const conversationId = body?.conversation_id || null;
  const webSearch = body?.web_search !== false;

  if (!text) return json(400, { error: 'Type a question first.' });
  if (text.length > MAX_TEXT_CHARS) {
    return json(400, { error: `That message is too long (${text.length.toLocaleString()} characters; the limit is ${MAX_TEXT_CHARS.toLocaleString()}). Attach it as a PDF instead.` });
  }
  if (attachmentIds.length > MAX_FILES_PER_MESSAGE) return json(400, { error: `Attach at most ${MAX_FILES_PER_MESSAGE} files to one message.` });
  if (attachmentIds.some((id) => typeof id !== 'string' || !UUID_RE.test(id))) return json(400, { error: 'Invalid attachment id' });
  if (conversationId !== null && (typeof conversationId !== 'string' || !UUID_RE.test(conversationId))) {
    return json(400, { error: 'Invalid conversation id' });
  }

  const db = auth.admin;
  const userId = auth.profile.id;

  // ── Daily cap ──────────────────────────────────────────────────────────────
  // A coarse guard on spend, not a rate limiter: replies in the user's chats
  // over the last 24 hours.
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const { data: recentChats, error: rcErr } = await db.from('ai_chat_conversations')
    .select('id').eq('user_id', userId).gte('updated_at', since);
  if (rcErr) return dbFail('recent chats', rcErr);
  if (recentChats?.length) {
    const { data: recent, error: rErr } = await db.from('ai_chat_messages')
      .select('id').in('conversation_id', recentChats.map((c) => c.id))
      .eq('role', 'assistant').gte('created_at', since);
    if (rErr) return dbFail('recent replies', rErr);
    if ((recent?.length || 0) >= dailyLimit(env)) {
      return json(429, { error: `You've reached today's limit of ${dailyLimit(env)} replies. It resets on a rolling 24 hours.` });
    }
  }

  // ── Conversation ───────────────────────────────────────────────────────────
  let conv;
  let createdConv = false;
  if (conversationId) {
    const { data, error } = await db.from('ai_chat_conversations')
      .select('id, title, message_count').eq('id', conversationId).eq('user_id', userId);
    if (error) return dbFail('load chat', error);
    conv = data?.[0];
    if (!conv) return json(404, { error: 'Chat not found' });
    if (conv.message_count + 2 > MAX_MESSAGES) {
      return json(400, { error: 'This chat has reached its length limit. Start a new chat to keep going.' });
    }
  } else {
    const { data, error } = await db.from('ai_chat_conversations')
      .insert({ user_id: userId, title: titleFrom(text) }).select('id, title, message_count');
    if (error) return dbFail('create chat', error);
    conv = data[0];
    createdConv = true;
  }

  // Rolls back what this request created when the turn fails.
  const rollback = async (userMessageId) => {
    try {
      if (userMessageId) await db.from('ai_chat_messages').delete().eq('id', userMessageId);
      if (createdConv) {
        // Detach first: the files survive for the retry, which arrives without
        // a conversation id and creates the chat again.
        await db.from('ai_chat_attachments').update({ conversation_id: null }).eq('conversation_id', conv.id);
        await db.from('ai_chat_conversations').delete().eq('id', conv.id);
      }
    } catch (err) {
      console.error('[ai-chat-send] rollback failed', err?.message || err);
    }
  };

  // ── Attachments for this question ─────────────────────────────────────────
  if (attachmentIds.length) {
    const { data: atts, error } = await db.from('ai_chat_attachments')
      .select('id, conversation_id').in('id', attachmentIds).eq('user_id', userId);
    if (error) { await rollback(null); return dbFail('load attachments', error); }
    const usable = (atts || []).filter((a) => a.conversation_id === null || a.conversation_id === conv.id);
    if (usable.length !== attachmentIds.length) {
      await rollback(null);
      return json(400, { error: 'One of the attached files is no longer available. Remove it and attach it again.' });
    }
    const unlinked = usable.filter((a) => a.conversation_id === null).map((a) => a.id);
    if (unlinked.length) {
      const { error: linkErr } = await db.from('ai_chat_attachments')
        .update({ conversation_id: conv.id }).in('id', unlinked);
      if (linkErr) { await rollback(null); return dbFail('link attachments', linkErr); }
    }
  }

  // ── Save the question ─────────────────────────────────────────────────────
  const userContent = [
    ...attachmentIds.map((id) => ({ type: 'attachment', attachment_id: id })),
    { type: 'text', text },
  ];
  const { data: inserted, error: insErr } = await db.from('ai_chat_messages')
    .insert({ conversation_id: conv.id, role: 'user', content: userContent }).select('id');
  if (insErr) { await rollback(null); return dbFail('save question', insErr); }
  const userMessageId = inserted[0].id;

  // ── Rebuild the conversation for the API ──────────────────────────────────
  let messages;
  try {
    const { data: rows, error } = await db.from('ai_chat_messages')
      .select('id, role, content, created_at').eq('conversation_id', conv.id).order('created_at', { ascending: true });
    if (error) throw new Error(`load history: ${error.message}`);

    const wanted = attachmentIdsIn(rows);
    const files = new Map();
    if (wanted.size) {
      const { data: atts, error: aErr } = await db.from('ai_chat_attachments')
        .select('id, r2_key, file_name, content_type, size_bytes').in('id', [...wanted]);
      if (aErr) throw new Error(`load files: ${aErr.message}`);
      const total = (atts || []).reduce((n, a) => n + a.size_bytes, 0);
      if (total > MAX_CHAT_FILE_BYTES) {
        await rollback(userMessageId);
        return json(400, { error: `The files in this chat add up to more than ${MAX_CHAT_FILE_BYTES / 1024 / 1024} MB. Start a new chat for this document.` });
      }
      for (const a of atts || []) {
        const obj = await env.R2.get(a.r2_key);
        if (!obj) continue;   // toApiMessages notes the missing file in its place
        files.set(a.id, { file_name: a.file_name, content_type: a.content_type, base64: toBase64(new Uint8Array(await obj.arrayBuffer())) });
      }
    }
    messages = toApiMessages(rows, files);
  } catch (err) {
    console.error('[ai-chat-send]', err?.message || err);
    await rollback(userMessageId);
    return json(500, { error: 'Could not load this chat. Try again.' });
  }

  const system = systemPrompt(env, todayInFirmZone());
  const callClaude = (msgs) => {
    const { headers, body: reqBody } = buildRequest(env, { system, messages: msgs, webSearch });
    return fetch(API_URL, { method: 'POST', headers, body: JSON.stringify(reqBody) });
  };

  let first;
  try {
    first = await callClaude(messages);
  } catch (err) {
    console.error('[ai-chat-send] network error', err?.message || err);
    await rollback(userMessageId);
    return json(502, { error: 'Could not reach Claude. Try again in a moment.' });
  }
  if (!first.ok) {
    const detail = await first.text().catch(() => '');
    console.error('[ai-chat-send] Claude API error', first.status, detail.slice(0, 500));
    await rollback(userMessageId);
    return json(first.status === 429 || first.status === 529 ? 503 : 502, { error: apiErrorMessage(first.status, detail) });
  }

  // ── Stream the answer ─────────────────────────────────────────────────────
  const { readable, writable } = new TransformStream();
  const writer = writable.getWriter();
  const encoder = new TextEncoder();
  let clientGone = false;
  const emit = async (evt) => {
    if (clientGone) return;
    try { await writer.write(encoder.encode(`${JSON.stringify(evt)}\n`)); } catch { clientGone = true; }
  };

  const forward = (evt, block) => {
    if (evt.type === 'content_block_delta') {
      if (evt.delta?.type === 'text_delta') emit({ type: 'text', text: evt.delta.text || '' });
      else if (evt.delta?.type === 'thinking_delta') emit({ type: 'thinking', text: evt.delta.thinking || '' });
    } else if (evt.type === 'content_block_stop' && block?.type === 'server_tool_use' && block.name === 'web_search') {
      emit({ type: 'search', query: String(block.input?.query || '') });
    } else if (evt.type === 'ping') {
      emit({ type: 'ping' });
    }
  };

  const run = async () => {
    await emit({ type: 'start', conversation_id: conv.id, title: conv.title });
    try {
      const content = [];
      let usage = {};
      let model = null;
      let stopReason = null;
      let res = first;
      for (let round = 0; ; round++) {
        const asm = createMessageAssembler({ onEvent: forward });
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          asm.push(decoder.decode(value, { stream: true }));
        }
        asm.push(decoder.decode());
        if (asm.error()) throw new TurnError(`stream: ${asm.error()}`, 'Claude stopped partway through. Try again.');
        content.push(...asm.blocks());
        usage = addUsage(usage, asm.usage());
        model = asm.model() || model;
        stopReason = asm.stopReason();

        // A long run of web searches pauses the server's loop; resending the
        // reply so far resumes it (no "continue" message: the trailing
        // server_tool_use block is the signal).
        if (stopReason === 'pause_turn' && round < MAX_CONTINUATIONS) {
          res = await callClaude([...messages, { role: 'assistant', content }]);
          if (!res.ok) {
            const detail = await res.text().catch(() => '');
            throw new TurnError(`resume ${res.status}: ${detail.slice(0, 300)}`, apiErrorMessage(res.status, detail));
          }
          continue;
        }
        break;
      }

      if (stopReason === 'refusal') {
        throw new TurnError('refused', 'Claude declined to answer this one. Try rephrasing the question.');
      }
      if (!content.some((b) => b.type === 'text' && b.text?.trim())) {
        throw new TurnError(`no text (stop_reason ${stopReason})`, 'Claude did not return an answer. Try again.');
      }

      const { data: saved, error: saveErr } = await db.from('ai_chat_messages')
        .insert({ conversation_id: conv.id, role: 'assistant', content, model, stop_reason: stopReason, usage })
        .select('id, role, content, model, stop_reason, usage, created_at');
      if (saveErr) throw new TurnError(`save reply: ${saveErr.message}`, 'The answer could not be saved. Try again.');

      const { error: convErr } = await db.from('ai_chat_conversations')
        .update({ message_count: conv.message_count + 2, updated_at: new Date().toISOString() })
        .eq('id', conv.id);
      if (convErr) console.error('[ai-chat-send] chat touch failed', convErr.message);

      await emit({ type: 'done', message: saved[0] });
    } catch (err) {
      console.error('[ai-chat-send] turn failed:', err?.message || err);
      await rollback(userMessageId);
      await emit({ type: 'error', error: err instanceof TurnError ? err.userMessage : 'Something went wrong. Try again.' });
    } finally {
      try { await writer.close(); } catch { /* client already gone */ }
    }
  };

  const done = run();
  if (ctx?.waitUntil) ctx.waitUntil(done);

  return new Response(readable, {
    status: 200,
    headers: {
      'Content-Type': 'application/x-ndjson; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}

class TurnError extends Error {
  constructor(message, userMessage) {
    super(message);
    this.userMessage = userMessage;
  }
}

function dbFail(what, error) {
  console.error(`[ai-chat-send] ${what}:`, error?.message || error);
  return json(500, { error: 'Something went wrong. Try again.' });
}

export function apiErrorMessage(status, detail = '') {
  if (status === 429 || status === 529) return 'Claude is busy right now. Try again in a minute.';
  if (status === 413 || /prompt is too long|too many tokens|request_too_large/i.test(detail)) {
    return 'This chat is too long for Claude to read at once. Start a new chat.';
  }
  if (status === 400 && /pdf|document|image/i.test(detail)) return 'Claude could not read one of the attached files.';
  return 'Claude could not answer right now. Try again.';
}
