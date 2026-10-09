// CF Worker: POST /api/package-builder/analyze
// Body: { matter_id, document_ids: [uuid] }
//
// The read side of Package Builder. The documents have already been uploaded
// through the normal trio (get-upload-url -> upload-proxy -> confirm-upload),
// so they are malware-scanned `documents` rows on this matter. This endpoint
// fetches their bytes from R2, sends them to Claude constrained to THIS
// matter's package forms, and records — per detected page — which form + page
// it belongs to and how it fares on the three checks (edition / signed+dated /
// footer). It writes nothing to any filing; the splice is /apply.
//
// Routing is deliberately constrained to the matter's own forms: we don't ask
// "what USCIS form is this?" open-world, we ask "which of THESE, which page?".
// The checks flag, they don't hold — a page that routes to a form with a
// generated version is `pending` (Apply-able, flags shown for review); anything
// unrouted or with nothing to splice into is `skipped` and just stays the
// regular document it already is.

import { verifyAuth, makeAdminClient, json } from './_helpers.js';
import { loadPackageTemplates } from './_fill-context.js';

// Claude can read PDFs (document block) and raster images (image block). TIFF
// and anything else can't be sent — those pages are recorded as skipped.
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

// Bound the Claude payload. USCIS packages returning signature pages are small;
// a fat high-DPI combined scan is the risk. ~25MB total, 20 documents.
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_DOCS        = 20;

const SYSTEM_PROMPT = `You are a document intake assistant for a US immigration law firm. The firm has sent a client a finalized USCIS form package to sign, and the client has scanned and returned signature pages — sometimes as one combined PDF, sometimes as individual page scans. Your job is to look at every page of every document provided and determine, for each page, which USCIS form it is a page of and which page number of that form it is.

Every USCIS form page prints a footer containing: the form number and edition date (e.g. "Form I-765 08/21/25" or "I-765 08/21/25"), a "Page X of Y" marker, and a PDF417 barcode. Read that footer to identify the form and page number.

You will be given the ONLY forms that belong to this matter's package (the CANDIDATE FORMS). A returned page belongs to exactly one of those forms, or to none of them (a supporting document, an unrelated page, or an unreadable scan). Never invent a form that is not in the candidate list — use null when a page does not clearly match one.

For each page, also assess:
- signed: is there a handwritten signature in a signature field on this page?
- dated: is there a handwritten date next to that signature?
- footer_visible: are ALL THREE of the footer elements (edition date, PDF417 barcode, and "Page X of Y") fully visible and not cut off?
- edition_detected: the edition date string printed in the footer (e.g. "08/21/25"), or null if unreadable.

Respond with VALID JSON ONLY — no markdown, no prose, no code fences. Shape:
{
  "pages": [
    {
      "source_document_index": <int, the DOCUMENT number you were given>,
      "source_page_index": <int, 0-based page within that document>,
      "form_key": <lowercased USCIS number like "i-765", or null>,
      "form_page_number": <int, the "X" in "Page X of Y", or null>,
      "form_total_pages": <int, the "Y", or null>,
      "edition_detected": <string or null>,
      "signed": <true|false>,
      "dated": <true|false>,
      "footer_visible": <true|false>,
      "confidence": <number 0..1>,
      "notes": <short string, one phrase>
    }
  ]
}
Return one entry for EVERY page of EVERY document, in order.`;

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handle(request, env);
  } catch (err) {
    console.error('[package-builder-analyze]', err);
    return json(500, { error: err?.message || 'Unexpected error' });
  }
}

async function handle(request, env) {
  if (request.method !== 'POST') return json(405, { error: 'Method not allowed' });

  const auth = await verifyAuth(request, env, 'write', 'draft_forms');
  if (auth.httpError) return json(auth.httpError.status, { error: auth.httpError.message });

  let body;
  try { body = await request.json(); }
  catch { return json(400, { error: 'Invalid JSON' }); }

  const { matter_id } = body;
  const documentIds = Array.isArray(body.document_ids) ? body.document_ids.filter(Boolean) : [];
  if (!matter_id)          return json(400, { error: 'matter_id is required' });
  if (!documentIds.length) return json(400, { error: 'Upload at least one document to analyze.' });
  if (documentIds.length > MAX_DOCS) return json(400, { error: `Too many files at once (max ${MAX_DOCS}).` });

  const admin = makeAdminClient(env);

  // ── Matter + its candidate forms ──────────────────────────────────────────
  const { data: matter, error: matterErr } = await admin
    .from('matters')
    .select('id, case_type_id')
    .eq('id', matter_id)
    .single();
  if (matterErr || !matter) return json(404, { error: 'Matter not found' });

  const pkgResult = await loadPackageTemplates(admin, matter);
  if (pkgResult.error) return json(pkgResult.error.status, { error: pkgResult.error.message });
  const candidates = pkgResult.activeTemplates || [];
  if (!candidates.length) {
    return json(422, { error: 'This matter has no forms yet, so there is nothing to route signed pages into.' });
  }

  // Expected edition per form. form_editions is the authoritative, daily-updated
  // source proof-scan trusts (keyed by uppercase form number); form_templates
  // .edition_date is a secondary fallback for any custom form not seeded there.
  // loadPackageTemplates doesn't select edition_date, so fetch it here.
  const editionByKey = {};
  const { data: tmplEds } = await admin
    .from('form_templates')
    .select('form_key, edition_date')
    .in('id', candidates.map(t => t.id));
  for (const t of tmplEds || []) if (t.edition_date) editionByKey[t.form_key] = t.edition_date;
  try {
    const { data: eds } = await admin.from('form_editions').select('form_number, edition_date');
    for (const e of eds || []) {
      const k = String(e.form_number || '').toLowerCase();
      if (k && e.edition_date) editionByKey[k] = e.edition_date;   // authoritative — wins
    }
  } catch { /* form_editions missing — form_templates fallback already applied */ }

  const candidateByKey = {};
  for (const t of candidates) candidateByKey[t.form_key] = t;

  // Splice target = the LATEST generated version of each form on this matter,
  // draft OR finalized (the user's choice — no need to finalize first). A routed
  // page whose form was never generated has nothing to replace into.
  const { data: genRows } = await admin
    .from('generated_forms')
    .select('id, template_id, version_num, status, form:form_templates(form_key)')
    .eq('matter_id', matter_id)
    .order('version_num', { ascending: false });
  const targetByKey = {};
  for (const g of genRows || []) {
    const k = g.form?.form_key;
    if (k && !targetByKey[k]) targetByKey[k] = g;   // first seen = highest version_num
  }

  // ── Load the uploaded documents' bytes from R2 ────────────────────────────
  const { data: docs, error: docsErr } = await admin
    .from('documents')
    .select('id, matter_id, name, file_name, r2_key, content_type, status, scan_status, deleted_at')
    .in('id', documentIds);
  if (docsErr) return json(500, { error: docsErr.message });

  const sources = [];   // { doc, contentBlock } in the order given
  let totalBytes = 0;
  for (const id of documentIds) {
    const doc = (docs || []).find(d => d.id === id);
    if (!doc)                       return json(404, { error: 'One of the documents was not found.' });
    if (doc.matter_id !== matter_id) return json(403, { error: 'A document does not belong to this matter.' });
    if (doc.deleted_at)             return json(410, { error: `"${doc.name}" has been deleted.` });
    if (doc.scan_status === 'infected') return json(422, { error: `"${doc.name}" failed the malware scan and can't be analyzed.` });
    if (!doc.r2_key || doc.r2_key.startsWith('pending/')) {
      return json(409, { error: `"${doc.name}" hasn't finished uploading yet.` });
    }

    const isPdf   = doc.content_type === 'application/pdf';
    const isImage = IMAGE_TYPES.has(doc.content_type);
    if (!isPdf && !isImage) {
      // Can't send to Claude (e.g. TIFF) — keep it in the run as a skipped source.
      sources.push({ doc, contentBlock: null });
      continue;
    }

    const obj = await env.R2.get(doc.r2_key);
    if (!obj) return json(409, { error: `"${doc.name}" could not be read from storage.` });
    const bytes = new Uint8Array(await obj.arrayBuffer());
    totalBytes += bytes.length;
    if (totalBytes > MAX_TOTAL_BYTES) {
      return json(413, { error: `These files are too large to analyze together (limit ${(MAX_TOTAL_BYTES / 1024 / 1024) | 0}MB). Try fewer or smaller files.` });
    }
    const data = bytesToBase64(bytes);
    sources.push({
      doc,
      contentBlock: isPdf
        ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }
        : { type: 'image',    source: { type: 'base64', media_type: doc.content_type, data } },
    });
  }

  const analyzable = sources.filter(s => s.contentBlock);
  if (!analyzable.length) {
    return json(422, { error: 'None of these files are a PDF or image we can analyze.' });
  }

  // ── Build the Claude message ──────────────────────────────────────────────
  const candidateLines = candidates.map(t => {
    const ed = editionByKey[t.form_key] ? ` — expected edition ${editionByKey[t.form_key]}` : '';
    return `- ${t.form_key} (${t.label})${ed}`;
  }).join('\n');

  const content = [];
  sources.forEach((s, idx) => {
    if (!s.contentBlock) return;
    content.push({ type: 'text', text: `=== DOCUMENT ${idx}: ${s.doc.name || s.doc.file_name || 'document'} ===` });
    content.push(s.contentBlock);
  });
  content.push({
    type: 'text',
    text: `CANDIDATE FORMS (the only forms in this matter's package):\n${candidateLines}\n\nAnalyze every page of every document above and return the JSON described in the system prompt. Use the DOCUMENT number shown before each file as source_document_index.`,
  });

  // ── Call Claude (same model + pdfs beta as proof-scan) ────────────────────
  let claudeData;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key':         env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'anthropic-beta':    'pdfs-2024-09-25',
        'content-type':      'application/json',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens: 4096,
        system:     SYSTEM_PROMPT,
        messages:   [{ role: 'user', content }],
      }),
    });
    if (!res.ok) throw new Error(`Claude API ${res.status}: ${await res.text()}`);
    claudeData = await res.json();
  } catch (err) {
    console.error('[package-builder-analyze] Claude error:', err.message);
    return json(502, { error: 'The AI analysis could not be completed. Please try again.' });
  }

  const rawText = claudeData?.content?.[0]?.text || '';
  let parsed;
  try { parsed = JSON.parse(stripFences(rawText)); }
  catch (err) {
    console.error('[package-builder-analyze] JSON parse failed:', rawText.slice(0, 500));
    return json(502, { error: 'The AI returned an unexpected response. Please try again.' });
  }
  const detected = Array.isArray(parsed?.pages) ? parsed.pages : [];
  const tokensUsed = claudeData?.usage?.output_tokens ?? null;

  // ── Turn detections into intake page rows ─────────────────────────────────
  const batchId = crypto.randomUUID();
  const pageRows = [];

  for (const p of detected) {
    const srcIdx = Number.isInteger(p.source_document_index) ? p.source_document_index : null;
    const source = srcIdx != null ? sources[srcIdx] : null;
    if (!source) continue;   // model referenced a document we didn't send

    const formKey = normalizeKey(p.form_key);
    const tmpl    = formKey ? candidateByKey[formKey] : null;
    const editionDetected = p.edition_detected ? String(p.edition_detected) : null;
    const editionExpected = formKey ? (editionByKey[formKey] || null) : null;

    const checks = {
      edition_ok:     editionOk(editionDetected, editionExpected),   // true | false | null (unknown)
      signed:         p.signed === true,
      dated:          p.dated === true,
      footer_visible: p.footer_visible === true,
    };

    const target = tmpl ? targetByKey[formKey] : null;
    const { status, reason } = classify({ tmpl, formKey, checks, target });

    pageRows.push({
      id:                       crypto.randomUUID(),
      batch_id:                 batchId,
      source_document_id:       source.doc.id,
      source_page_index:        Number.isInteger(p.source_page_index) ? p.source_page_index : null,
      form_key:                 formKey,
      target_template_id:       tmpl?.id || null,
      target_generated_form_id: target?.id || null,
      target_page_number:       Number.isInteger(p.form_page_number) ? p.form_page_number : null,
      form_total_pages:         Number.isInteger(p.form_total_pages) ? p.form_total_pages : null,
      edition_detected:         editionDetected,
      edition_expected:         editionExpected,
      checks,
      confidence:               typeof p.confidence === 'number' ? p.confidence : null,
      reason,
      status,
    });
  }

  // Sources Claude never reported on (e.g. an unreadable/TIFF scan) — record a
  // held row so the reviewer sees the file was handled, not silently dropped.
  const reportedDocIds = new Set(pageRows.map(r => r.source_document_id));
  for (const s of sources) {
    if (reportedDocIds.has(s.doc.id)) continue;
    pageRows.push({
      id:                 crypto.randomUUID(),
      batch_id:           batchId,
      source_document_id: s.doc.id,
      source_page_index:  null,
      form_key:           null,
      checks:             {},
      status:             'skipped',
      reason:             s.contentBlock
        ? 'The AI could not read a form page from this file — it stays as a regular document.'
        : 'This file type can\'t be analyzed (only PDF and JPG/PNG images) — it stays as a regular document.',
    });
  }

  // ── Persist batch + pages ─────────────────────────────────────────────────
  const { error: batchErr } = await admin.from('package_builder_batches').insert({
    id:           batchId,
    matter_id,
    status:       'ready',
    source_count: sources.length,
    tokens_used:  tokensUsed,
    created_by:   auth.profile?.id || null,
  });
  if (batchErr) return json(500, { error: batchErr.message });

  if (pageRows.length) {
    const { error: pagesErr } = await admin.from('package_builder_pages').insert(pageRows);
    if (pagesErr) return json(500, { error: pagesErr.message });
  }

  // ── Response for the review panel ─────────────────────────────────────────
  const docName = id => {
    const d = (docs || []).find(x => x.id === id);
    return d?.name || d?.file_name || 'document';
  };
  const pages = pageRows.map(r => ({
    id:                       r.id,
    source_document_id:       r.source_document_id,
    source_name:              docName(r.source_document_id),
    source_page_index:        r.source_page_index,
    form_key:                 r.form_key,
    label:                    r.form_key ? (candidateByKey[r.form_key]?.label || r.form_key) : null,
    target_generated_form_id: r.target_generated_form_id,
    target_page_number:       r.target_page_number,
    form_total_pages:         r.form_total_pages,
    edition_detected:         r.edition_detected,
    edition_expected:         r.edition_expected,
    checks:                   r.checks,
    confidence:               r.confidence,
    reason:                   r.reason,
    status:                   r.status,
    applyable:                r.status === 'pending' && !!r.target_generated_form_id,
  }));

  return json(200, {
    batch_id: batchId,
    pages,
    summary: {
      applyable: pages.filter(p => p.applyable).length,
      skipped:   pages.filter(p => !p.applyable).length,
    },
  });
}

// ── Classification (flag, don't hold) ──────────────────────────────────────────
// The checks never withhold a page — they surface as advisory flags and the
// reviewer decides. A page is `pending` (applyable) as long as it routes to a
// form that has a generated version to replace into. Everything else is
// `skipped`: either unrouted (stays a document) or routed to a form that was
// never generated (nothing to splice into yet). Whether a pending page is
// applyable is derived downstream from target_generated_form_id.
function classify({ tmpl, formKey, checks, target }) {
  if (!tmpl) {
    return { status: 'skipped', reason: 'Not one of this matter\'s forms — stays as a regular document.' };
  }
  if (!target) {
    return { status: 'skipped', reason: `${formKey.toUpperCase()} hasn't been generated on this matter yet — generate it first, then re-run Package Builder.` };
  }
  const flags = [];
  if (checks.edition_ok === false) flags.push('edition date does not match the current form');
  if (checks.edition_ok === null)  flags.push('edition date could not be verified');
  if (!checks.signed)              flags.push('no signature detected');
  if (!checks.dated)               flags.push('no signature date detected');
  if (!checks.footer_visible)      flags.push('footer not fully visible');
  const reason = flags.length
    ? `Ready to apply — review: ${flags.join('; ')}.`
    : 'Ready to apply.';
  return { status: 'pending', reason };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function normalizeKey(k) {
  if (!k || typeof k !== 'string') return null;
  const s = k.trim().toLowerCase().replace(/^form\s+/, '');
  return s || null;
}

// USCIS editions print as MM/DD/YY. Compare on (month, day, 2-digit year) so
// "08/21/25" and "08/21/2025" match. Returns true | false | null(unknown).
function editionOk(detected, expected) {
  if (!detected || !expected) return null;
  const a = parseEdition(detected);
  const b = parseEdition(expected);
  if (!a || !b) return null;
  return a === b;
}
function parseEdition(s) {
  const m = String(s).match(/(\d{1,2})\D+(\d{1,2})\D+(\d{2,4})/);
  if (!m) return null;
  const mm = m[1].padStart(2, '0');
  const dd = m[2].padStart(2, '0');
  const yy = (Number(m[3]) % 100).toString().padStart(2, '0');
  return `${mm}${dd}${yy}`;
}

function stripFences(text) {
  return String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

// btoa over a large byte array blows the call stack — chunk it.
function bytesToBase64(bytes) {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
