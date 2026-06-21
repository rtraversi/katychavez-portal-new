// POST /api/analyze-document
// Sends a PDF or image to Claude Haiku to detect document type + suggest a name.
// Returns { doc_type, doc_name } — always 200; graceful empty result on any failure
// so the caller can still proceed with manual input.
//
// Body: { file_base64: string, content_type: string, file_name: string }

import { verifyAuth, json } from './_helpers.js';

const VALID_TYPES = ['pleading', 'agreement', 'correspondence', 'financial', 'id', 'court_order', 'other'];
const EMPTY       = { doc_type: 'other', doc_name: '' };

export async function onRequest({ request, env }) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'uploads');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  if (!env.ANTHROPIC_API_KEY) {
    console.warn('[analyze-document] ANTHROPIC_API_KEY not set — returning empty result');
    return json(200, EMPTY);
  }

  let body;
  try { body = await request.json(); } catch { return json(400, { error: 'Invalid JSON' }); }

  const { file_base64, content_type, file_name } = body;
  if (!file_base64)  return json(400, { error: 'file_base64 is required.' });
  if (!content_type) return json(400, { error: 'content_type is required.' });
  if (file_base64.length > 50 * 1024 * 1024) return json(413, { error: 'File too large for analysis.' });

  const mediaType = content_type.split(';')[0].trim().toLowerCase();

  // Build the Anthropic content block based on file type
  let fileBlock;
  if (mediaType === 'application/pdf') {
    fileBlock = {
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: file_base64 },
    };
  } else if (['image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp'].includes(mediaType)) {
    fileBlock = {
      type: 'image',
      source: { type: 'base64', media_type: mediaType === 'image/jpg' ? 'image/jpeg' : mediaType, data: file_base64 },
    };
  } else {
    // Unsupported type (e.g. TIFF) — return empty so caller falls through to manual input
    return json(200, EMPTY);
  }

  const prompt = `You are helping a family law firm staff member file an incoming document.

Analyze this document and respond with ONLY a JSON object:
{"doc_type":"<type>","doc_name":"<name>"}

doc_type must be exactly one of: pleading, agreement, correspondence, financial, id, court_order, other
doc_name should be 2–6 words describing what this specific document is (e.g. "Financial Affidavit", "Petition for Divorce", "Driver's License", "Retainer Agreement")

Respond ONLY with the JSON. No explanation, no markdown fences.`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':      'application/json',
        'x-api-key':         env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model:      'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{
          role:    'user',
          content: [fileBlock, { type: 'text', text: prompt }],
        }],
      }),
    });

    if (!res.ok) {
      const txt = await res.text().catch(() => '');
      console.error('[analyze-document] Anthropic HTTP error:', res.status, txt.slice(0, 200));
      return json(200, EMPTY);
    }

    const data    = await res.json();
    const rawText = (data.content?.[0]?.text || '{}').trim()
      .replace(/^```[a-z]*\n?/i, '').replace(/\n?```$/i, '').trim();

    const result = JSON.parse(rawText);
    return json(200, {
      doc_type: VALID_TYPES.includes(result.doc_type) ? result.doc_type : 'other',
      doc_name: typeof result.doc_name === 'string' ? result.doc_name.trim().slice(0, 100) : '',
    });

  } catch (err) {
    console.error('[analyze-document] error:', err.message);
    return json(200, EMPTY);
  }
}
