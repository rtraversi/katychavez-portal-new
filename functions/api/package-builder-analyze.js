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
import { segmentPackage, bytesToBase64, contentBlockFor, IMAGE_TYPES } from './_segment-package.js';

// Bound the Claude payload. USCIS packages returning signature pages are small;
// a fat high-DPI combined scan is the risk. ~25MB total, 20 documents.
const MAX_TOTAL_BYTES = 25 * 1024 * 1024;
const MAX_DOCS        = 20;

// The segmenter prompt, the Claude call and the JSON contract now live in
// _segment-package.js — proof scan needs the same page map (PROOF-SCAN-HANDOFF.md §12 step 5).

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
    sources.push({
      doc,
      contentBlock: contentBlockFor(doc.content_type, bytesToBase64(bytes)),
    });
 }

  const analyzable = sources.filter(s => s.contentBlock);
  if (!analyzable.length) {
    return json(422, { error: 'None of these files are a PDF or image we can analyze.' });
  }

  // ── Segment: which form is each page, and which page of it? ──────────────
  // The call itself lives in _segment-package.js because proof scan needs the
  // same page map over a whole filing (PROOF-SCAN-HANDOFF.md §12 step 5).
  let segmented;
  try {
    segmented = await segmentPackage(env, {
      documents: sources.map(s => ({ label: s.doc.name || s.doc.file_name || 'document', contentBlock: s.contentBlock })),
      candidates: candidates.map(t => ({ form_key: t.form_key, label: t.label, edition_date: editionByKey[t.form_key] })),
    });
  } catch (err) {
    console.error('[package-builder-analyze] segmenter error:', err.message);
    return json(502, err.kind === 'parse'
      ? { error: 'The AI returned an unexpected response. Please try again.' }
      : { error: 'The AI analysis could not be completed. Please try again.' });
  }

  const detected = segmented.pages;
  const tokensUsed = segmented.usage?.output_tokens ?? null;

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

