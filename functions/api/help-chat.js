// help-chat.js — Portal help assistant endpoint
// POST /api/help-chat
// Body: { messages: [{ role: 'user'|'assistant', content: string }] }
// Auth: any authenticated role (staff + clients)

import { verifyAuth, json } from './_helpers.js';
import { KNOWLEDGE_BASE } from './_kb/knowledge-base.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'read', 'core', { clientBypass: true });
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { messages } = body;
  if (!Array.isArray(messages) || messages.length === 0) {
    return json(400, { error: 'messages array is required' });
  }

  // Bound the request so an authenticated user can't drive unbounded Anthropic
  // cost by sending a huge conversation. (This is a coarse cap, not a rate limit —
  // real per-user throttling would need a KV/Durable Object counter.)
  if (messages.length > 40) {
    return json(400, { error: 'Conversation too long. Please start a new chat.' });
  }
  let totalChars = 0;
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant') || typeof m.content !== 'string') {
      return json(400, { error: 'Invalid message format' });
    }
    totalChars += m.content.length;
  }
  if (totalChars > 24000) {
    return json(400, { error: 'Message is too long. Please shorten your question.' });
  }

  if (!env.ANTHROPIC_API_KEY) {
    console.warn('[help-chat] ANTHROPIC_API_KEY not configured');
    return json(503, { error: 'Help service not configured' });
  }

  const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      system:     KNOWLEDGE_BASE,
      messages,
    }),
  });

  if (!claudeRes.ok) {
    const errText = await claudeRes.text();
    console.error('[help-chat] Claude API error:', claudeRes.status, errText);
    return json(502, { error: 'Help service temporarily unavailable' });
  }

  const data = await claudeRes.json();
  const reply = data.content?.[0]?.text ?? '';
  return json(200, { reply });
}
