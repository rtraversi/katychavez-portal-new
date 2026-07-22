// translation-process.js — does the actual translation work.
// POST { translation_id }
// Called by the page right after /api/translation-start returns 202. This
// request stays open for the whole Claude generation (a Worker can run as
// long as the client is connected — unlike ctx.waitUntil(), which killed
// multi-page jobs). The page's poller drives the UI; this response is only
// consumed as a completion/error signal.
//
// Claim protocol: pending → processing → completed|error. The claim is a
// conditional UPDATE, so a double-fired request finds 0 rows and backs off.
// A job whose process request died mid-flight stays 'processing' — the user
// re-uploads (rare; requires the tab to close mid-translation).

import { verifyAuth, json, makeAdminClient } from './_helpers.js';
import { extractEntities }             from '../utils/extract-entities.js';
import { compressPdf }                 from '../utils/compress-pdf.js';
import { parseBlocks, blocksToText }   from '../utils/translation-docx.js';
import { readSseStream }               from '../utils/anthropic-stream.js';
import { tmpKey }                      from './translation-start.js';

// Generation cap: below the page's 10-minute poll ceiling so a hung stream
// still resolves to a stored 'error' the poller can see.
const CLAUDE_TIMEOUT_MS = 9 * 60_000;

const SYSTEM_PROMPT = `You are a professional legal document translator. Detect the source language of the provided document, translate it completely and accurately into English, then return ONLY a JSON object (no markdown fences, no commentary) in exactly this shape:

{"format":"blocks-v1","source_language":"Spanish","blocks":[ ... ]}

"source_language" is the English name of the document's source language (e.g. "Spanish", "Portuguese", "French").

Block types — use them to mirror the source document's visual layout:
- {"type":"subtitle","text":"UNITED MEXICAN STATES"} — small centered header line (country, state, issuing authority)
- {"type":"title","text":"BIRTH CERTIFICATE"} — the document's main title (use once)
- {"type":"section","text":"FATHER'S INFORMATION"} — a section heading within the document
- {"type":"fields","rows":[[{"label":"DATE OF BIRTH","value":"15 March 1995"},{"label":"TIME","value":"07:45 hours"}],[{"label":"CURP","value":"SMIJ950315HGTMHN07"}]]} — labeled data rendered as a compact grid. Each row is an array of 1 or 2 label/value pairs: use 2 pairs when the original shows two values side by side, 1 pair for full-width fields.
- {"type":"paragraph","text":"..."} — narrative or prose text
- {"type":"note","text":"[Round official seal: CIVIL REGISTRY — GTO.]"} — stamps, seals, watermarks, marginal annotations, described in square brackets
- {"type":"signatures","items":[{"caption":"SIGNATURE OF THE DECLARANT","name":"DAVE SMITH"},{"caption":"CIVIL REGISTRY OFFICER NO. 3","name":"LIC. ROBERTO MENDOZA FLORES"}]} — signature areas (1–3 side by side)

Rules:
- Translate ALL text in the document. Keep proper names, street addresses, and codes (CURP, folio, acta numbers) unchanged.
- Mirror the original's structure: same section order; two-column layouts become rows with 2 pairs; keep field grids as "fields" blocks, not paragraphs.
- Mark illegible content as "[illegible]".
- Do NOT add a translation certification block — the server appends it.
- The output must be valid JSON with no text before or after it.`;

function getMediaType(filename) {
  const lower = (filename || '').toLowerCase();
  if (lower.endsWith('.png'))                            return { type: 'image', media_type: 'image/png' };
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return { type: 'image', media_type: 'image/jpeg' };
  return { type: 'document', media_type: 'application/pdf' };
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

export async function onRequest({ request, env }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'translation');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { translation_id } = body;
  if (!translation_id) return json(400, { error: 'translation_id is required' });

  const admin = makeAdminClient(env);

  // Claim: pending → processing. Empty result = already claimed/finished.
  const { data: claimed } = await admin
    .from('translations')
    .update({ status: 'processing' })
    .eq('id', translation_id).eq('status', 'pending')
    .select('id, filename, translator_name');

  const job = claimed?.[0];
  if (!job) {
    const { data: rows } = await admin
      .from('translations').select('status').eq('id', translation_id).limit(1);
    const status = rows?.[0]?.status;
    if (!status) return json(404, { error: 'Translation not found' });
    return json(200, { ok: true, status }); // completed | error | processing (another request has it)
  }

  const fail = async (msg) => {
    console.error('[translation-process]', msg);
    await admin.from('translations').update({ status: 'error' }).eq('id', translation_id);
    return json(200, { ok: false, status: 'error' });
  };

  try {
    if (!env.R2) return await fail('R2 binding not configured');
    const obj = await env.R2.get(tmpKey(translation_id));
    if (!obj) return await fail('stashed file missing (temp object not found)');
    let bytes = new Uint8Array(await obj.arrayBuffer());

    const { type: contentType, media_type } = getMediaType(job.filename);

    // PDF compression — best effort, keeps Claude's input small.
    if (contentType === 'document' && env.ILOVEPDF_PUBLIC_KEY) {
      try {
        const compressed = await compressPdf(bytes, env.ILOVEPDF_PUBLIC_KEY);
        if (compressed.length < bytes.length) {
          console.log(`[translation-process] PDF compressed: ${bytes.length} → ${compressed.length} bytes`);
          bytes = compressed;
        }
      } catch (err) {
        console.error('[translation-process] compression failed, using original:', err.message);
      }
    }

    const fileData = bytesToBase64(bytes);
    const contentBlock = contentType === 'image'
      ? { type: 'image',    source: { type: 'base64', media_type, data: fileData } }
      : { type: 'document', source: { type: 'base64', media_type, data: fileData } };

    const claudeHeaders = {
      'x-api-key':         env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    };
    if (contentType === 'document') claudeHeaders['anthropic-beta'] = 'pdfs-2024-09-25';

    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method:  'POST',
      headers: claudeHeaders,
      signal:  AbortSignal.timeout(CLAUDE_TIMEOUT_MS),
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 32000,
        stream:     true,
        system:     SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            contentBlock,
            { type: 'text', text: `Translate this document into English. Translator name: ${job.translator_name || '_________________________'}` },
          ],
        }],
      }),
    });

    if (!claudeRes.ok) return await fail(`Claude API ${claudeRes.status}: ${await claudeRes.text()}`);

    const acc = await readSseStream(claudeRes);
    if (acc.error()) return await fail(`Claude stream error: ${acc.error()}`);
    const translatedText = acc.text();
    if (!translatedText.trim()) return await fail('Claude stream produced no text');
    if (acc.stopReason() === 'max_tokens') {
      console.warn('[translation-process] output hit max_tokens — translation may be truncated');
    }

    // Entity extraction — fail open
    const parsed   = parseBlocks(translatedText);
    const flatText = parsed ? blocksToText(parsed.blocks) : translatedText;

    let extracted_people = [];
    try {
      const entities = await Promise.race([
        extractEntities(flatText, env.ANTHROPIC_API_KEY, 'translation'),
        new Promise(resolve => setTimeout(() => resolve({ people: [] }), 30000)),
      ]);
      extracted_people = entities.people || [];
    } catch { /* fail open */ }

    await admin.from('translations')
      .update({ translated_text: translatedText, extracted_people, status: 'completed' })
      .eq('id', translation_id);

    return json(200, { ok: true, status: 'completed' });

  } catch (err) {
    return await fail(`processing error: ${err.message}`);
  } finally {
    // Temp object is single-use either way; the daily cron mops up strays.
    try { await env.R2?.delete(tmpKey(translation_id)); } catch { /* best effort */ }
  }
}
