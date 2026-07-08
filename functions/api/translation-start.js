// translation-start.js — starts an async translation job.
// POST { file_base64, filename, translator_name, translation_id }
// Returns 202 immediately; processing runs via ctx.waitUntil().

import { verifyAuth, json, makeAdminClient } from './_helpers.js';
import { extractEntities }             from '../utils/extract-entities.js';
import { compressPdf }                 from '../utils/compress-pdf.js';
import { parseBlocks, blocksToText }   from '../utils/translation-docx.js';

const SYSTEM_PROMPT = `You are a professional Spanish-to-English legal document translator. Translate the provided document completely and accurately, then return ONLY a JSON object (no markdown fences, no commentary) in exactly this shape:

{"format":"blocks-v1","blocks":[ ... ]}

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
  if (lower.endsWith('.png'))                        return { type: 'image', media_type: 'image/png' };
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return { type: 'image', media_type: 'image/jpeg' };
  return { type: 'document', media_type: 'application/pdf' };
}

async function processTranslation({ file_base64, filename, translator_name, translation_id }, env) {
  const admin = makeAdminClient(env);

  const patchStatus = async (fields) => {
    try {
      await admin.from('translations').update(fields).eq('id', translation_id);
    } catch (err) {
      console.error('[translation] DB patch error:', err.message);
    }
  };

  try {
    const { type: contentType, media_type } = getMediaType(filename);

    let fileData = file_base64;
    if (contentType === 'document' && env.ILOVEPDF_PUBLIC_KEY) {
      try {
        const raw    = atob(file_base64);
        const bytes  = new Uint8Array(raw.length);
        for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
        const before     = bytes.length;
        const compressed = await compressPdf(bytes, env.ILOVEPDF_PUBLIC_KEY);
        if (compressed.length < before) {
          let binary = '';
          for (let i = 0; i < compressed.length; i++) binary += String.fromCharCode(compressed[i]);
          fileData = btoa(binary);
        }
      } catch (err) {
        console.error('[translation] PDF compression failed, proceeding with original:', err.message);
      }
    }

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
      method: 'POST',
      headers: claudeHeaders,
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 16000,
        system:     SYSTEM_PROMPT,
        messages: [{
          role: 'user',
          content: [
            contentBlock,
            { type: 'text', text: `Translate this document from Spanish to English. Translator name: ${translator_name || '_________________________'}` },
          ],
        }],
      }),
    });

    if (!claudeRes.ok) throw new Error(`Claude API ${claudeRes.status}: ${await claudeRes.text()}`);
    const claude         = await claudeRes.json();
    const translatedText = claude.content[0].text;

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

    await patchStatus({ translated_text: translatedText, extracted_people, status: 'completed' });

  } catch (err) {
    console.error('[translation] processing error:', err.message);
    await patchStatus({ status: 'error' });
  }
}

export async function onRequest({ request, env, ctx }) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'translation');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { file_base64, filename, translator_name = '_________________________', translation_id } = body;
  if (!file_base64 || !translation_id)
    return json(400, { error: 'file_base64 and translation_id are required' });

  try {
    await auth.admin.from('translations').insert({
      id:              translation_id,
      filename:        filename || 'document.pdf',
      translator_name,
      status:          'pending',
    });
  } catch (err) {
    console.error('[translation] DB insert error:', err.message);
    return json(500, { error: 'Failed to create translation record' });
  }

  ctx.waitUntil(processTranslation({ file_base64, filename, translator_name, translation_id }, env));

  return json(202, { ok: true, translation_id });
}
