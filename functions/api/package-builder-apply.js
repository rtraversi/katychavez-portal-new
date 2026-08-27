// CF Worker: POST /api/package-builder/apply
// Body: { batch_id, page_ids?: [uuid] }   (omit page_ids to apply every
//                                           applyable page in the batch)
//
// The splice. For each selected Package Builder page, replace the matching page of
// the target form with the client's signed scan, producing a NEW signed copy —
// the clean generated draft/finalized PDF is never touched (decision 2). The
// target is the latest generated version of that form; repeated applies
// accumulate into the same signed copy (generated_forms.signed_r2_key), so
// signing page 4 then page 11 of an N-400 builds one signed PDF.
//
// Pages are grouped by target form so each PDF is loaded, spliced, and saved
// once. Per-page and per-form error isolation — one bad page never blocks the
// rest. See PACKAGE-BUILDER-PLAN.md.

import { PDFDocument } from 'pdf-lib';
import { verifyAuth, makeAdminClient, json } from './_helpers.js';

const PDF_TYPE   = 'application/pdf';
const JPG_TYPES  = new Set(['image/jpeg', 'image/jpg']);
const PNG_TYPE   = 'image/png';

export async function onRequest(context) {
  const { request, env } = context;
  try {
    return await handle(request, env);
  } catch (err) {
    console.error('[package-builder-apply]', err);
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

  const { batch_id } = body;
  const pageIds = Array.isArray(body.page_ids) ? body.page_ids.filter(Boolean) : null;
  if (!batch_id) return json(400, { error: 'batch_id is required' });

  const admin  = makeAdminClient(env);
  const userId = auth.profile?.id || null;

  const { data: batch, error: batchErr } = await admin
    .from('package_builder_batches')
    .select('id, matter_id')
    .eq('id', batch_id)
    .single();
  if (batchErr || !batch) return json(404, { error: 'Batch not found' });

  // Only pending pages that route to a generated target can be applied.
  let q = admin
    .from('package_builder_pages')
    .select('id, source_document_id, source_page_index, target_generated_form_id, target_page_number, form_key')
    .eq('batch_id', batch_id)
    .eq('status', 'pending')
    .not('target_generated_form_id', 'is', null);
  if (pageIds) q = q.in('id', pageIds);
  const { data: pages, error: pagesErr } = await q;
  if (pagesErr) return json(500, { error: pagesErr.message });
  if (!pages || !pages.length) return json(422, { error: 'No applyable pages in this selection.' });

  // Group by target form so each PDF is loaded and saved once.
  const byTarget = {};
  for (const p of pages) (byTarget[p.target_generated_form_id] ||= []).push(p);

  const sourceCache = new Map();   // document_id -> { pdfDoc | imageBytes, content_type }
  const results = [];

  for (const [generatedFormId, groupPages] of Object.entries(byTarget)) {
    try {
      const { data: gf, error: gfErr } = await admin
        .from('generated_forms')
        .select('id, matter_id, batch_id, r2_key, finalized_r2_key, signed_r2_key, status, template:form_templates(form_key)')
        .eq('id', generatedFormId)
        .single();
      if (gfErr || !gf) throw new Error('Generated form not found');
      if (gf.matter_id !== batch.matter_id) throw new Error('Target form is not on this matter');

      // Splice into the existing signed copy if one exists (accumulate), else the
      // finalized PDF, else the fillable draft.
      const baseKey = gf.signed_r2_key || (gf.status === 'finalized' ? gf.finalized_r2_key : gf.r2_key);
      if (!baseKey) throw new Error('No PDF to replace into');
      const baseObj = await env.R2.get(baseKey);
      if (!baseObj) throw new Error('Target PDF missing in storage');

      const targetDoc = await PDFDocument.load(await baseObj.arrayBuffer());
      const pageCount = targetDoc.getPageCount();

      for (const p of groupPages) {
        try {
          if (!Number.isInteger(p.target_page_number) || p.target_page_number < 1) {
            throw new Error('unknown target page number');
          }
          const targetIdx = p.target_page_number - 1;
          if (targetIdx >= pageCount) throw new Error(`target page ${p.target_page_number} is beyond the form (${pageCount} pages)`);

          const src = await loadSource(admin, env, sourceCache, p.source_document_id);
          await replacePage(targetDoc, targetIdx, src, p.source_page_index);

          results.push({ page_id: p.id, status: 'applied' });
        } catch (perr) {
          console.error(`[package-builder-apply] page ${p.id}:`, perr.message);
          results.push({ page_id: p.id, status: 'error', error: perr.message });
        }
      }

      const appliedIds = results.filter(r => r.status === 'applied' && groupPages.some(g => g.id === r.page_id)).map(r => r.page_id);
      if (!appliedIds.length) continue;   // nothing spliced for this form — don't write an unchanged copy

      const signedKey = `signed-forms/${gf.matter_id}/${gf.batch_id}/${gf.template.form_key}_signed.pdf`;
      const outBytes  = await targetDoc.save();
      await env.R2.put(signedKey, outBytes, { httpMetadata: { contentType: 'application/pdf' } });

      const nowIso = new Date().toISOString();
      await admin.from('generated_forms')
        .update({ signed_r2_key: signedKey, signed_at: nowIso, signed_by: userId })
        .eq('id', generatedFormId);

      await admin.from('package_builder_pages')
        .update({ status: 'applied', applied_at: nowIso, applied_by: userId, applied_r2_key: signedKey })
        .in('id', appliedIds);
    } catch (gerr) {
      console.error(`[package-builder-apply] target ${generatedFormId}:`, gerr.message);
      for (const p of groupPages) {
        if (!results.some(r => r.page_id === p.id)) results.push({ page_id: p.id, status: 'error', error: gerr.message });
      }
    }
  }

  const applied = results.filter(r => r.status === 'applied').length;
  return json(200, { applied, results });
}

// ── Source loading (cached per document) ───────────────────────────────────────
async function loadSource(admin, env, cache, documentId) {
  if (cache.has(documentId)) return cache.get(documentId);

  const { data: doc, error } = await admin
    .from('documents')
    .select('id, r2_key, content_type, deleted_at')
    .eq('id', documentId)
    .single();
  if (error || !doc)   throw new Error('source document not found');
  if (doc.deleted_at)  throw new Error('source document was deleted');
  if (!doc.r2_key)     throw new Error('source document has no file');

  const obj = await env.R2.get(doc.r2_key);
  if (!obj) throw new Error('source file missing in storage');
  const bytes = new Uint8Array(await obj.arrayBuffer());

  const entry = { content_type: doc.content_type, bytes };
  if (doc.content_type === PDF_TYPE) entry.pdfDoc = await PDFDocument.load(bytes);
  cache.set(documentId, entry);
  return entry;
}

// Replace page targetIdx of targetDoc with the client's scanned page. A PDF
// source contributes its page srcIndex; an image source becomes a full page at
// the replaced page's dimensions. Page count is preserved (remove + insert at
// the same index), so applying several pages to one form keeps every index
// stable.
async function replacePage(targetDoc, targetIdx, src, srcIndex) {
  const { width, height } = targetDoc.getPage(targetIdx).getSize();

  if (src.content_type === PDF_TYPE) {
    const idx = Number.isInteger(srcIndex) ? srcIndex : 0;
    if (idx >= src.pdfDoc.getPageCount()) throw new Error(`source page ${idx + 1} out of range`);
    const [copied] = await targetDoc.copyPages(src.pdfDoc, [idx]);
    targetDoc.removePage(targetIdx);
    targetDoc.insertPage(targetIdx, copied);
    return;
  }

  let img;
  if (JPG_TYPES.has(src.content_type))      img = await targetDoc.embedJpg(src.bytes);
  else if (src.content_type === PNG_TYPE)   img = await targetDoc.embedPng(src.bytes);
  else throw new Error(`can't splice a ${src.content_type} scan yet`);

  targetDoc.removePage(targetIdx);
  const page  = targetDoc.insertPage(targetIdx, [width, height]);
  const scale = Math.min(width / img.width, height / img.height);
  const w = img.width * scale, h = img.height * scale;
  page.drawImage(img, { x: (width - w) / 2, y: (height - h) / 2, width: w, height: h });
}
