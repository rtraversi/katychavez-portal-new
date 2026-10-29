// GET /api/ai-chat-stats: Ask Claude usage and storage, firm-wide.
// Auth: admin on ai_chat (the Owner role). Counts and sizes only; no chat content.
//
// Exists because chats are kept forever for now (2026-10-27): this is where
// database growth and monthly spend get watched.

import { verifyAuth, json } from './_helpers.js';
import { estimateCost } from './_ai-chat-common.js';

export async function onRequest({ request, env }) {
  if (request.method !== 'GET') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'admin', 'ai_chat');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });
  if (auth.isClient) return json(403, { error: 'Not available' });

  const { data, error } = await auth.admin.rpc('ai_chat_storage_stats');
  if (error) {
    console.error('[ai-chat-stats]', error.message);
    return json(500, { error: 'Usage could not be loaded.' });
  }

  const usage = (data?.usage || []).map((row) => ({ ...row, estimated_cost: round2(estimateCost(row)) }));
  const months = {};
  for (const row of usage) {
    const m = (months[row.month] ||= { month: row.month, replies: 0, web_searches: 0, estimated_cost: 0 });
    m.replies += Number(row.replies || 0);
    m.web_searches += Number(row.web_searches || 0);
    m.estimated_cost = round2(m.estimated_cost + row.estimated_cost);
  }

  return json(200, {
    conversations: Number(data?.conversations || 0),
    messages: Number(data?.messages || 0),
    attachments: Number(data?.attachments || 0),
    attachment_bytes: Number(data?.attachment_bytes || 0),
    table_bytes: Number(data?.table_bytes || 0),
    database_bytes: Number(data?.database_bytes || 0),
    users: Number(data?.users || 0),
    months: Object.values(months).sort((a, b) => (a.month < b.month ? 1 : -1)),
    usage,
  });
}

const round2 = (n) => Math.round(n * 100) / 100;
