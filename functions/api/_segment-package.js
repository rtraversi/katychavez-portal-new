// _segment-package.js — "which form is this page, and which page of it?"
//
// One model call that reads USCIS footers and returns a per-page map. It was
// written for Package Builder, which uses it to route a client's returned
// signature pages back into the right filing. It lives here because proof scan
// needs the same answer for a different reason: a 107-page AOS package has to
// become (form, page-range) spans before it can be checked span by span
// (PROOF-SCAN-HANDOFF.md §6, §12 step 5).
//
// Two properties make this worth sharing rather than reimplementing:
//
//   • It is closed-world by construction. The caller passes the ONLY forms a
//     page may belong to, and the prompt says to answer null rather than invent
//     one. Package Builder passes a matter's package; proof scan passes the
//     form_editions catalogue. Neither asks "what USCIS form is this?" openly.
//
//   • It is self-checking. Every form's page count is already known
//     (form_editions.pages), so a span claiming I-485 pages 1-24 can be tested
//     against the expected 24 without asking a model anything — see checkSpans.
//     A disagreement is not a segmenter bug to hide; it is a finding.
//
// This is still a model call, not a parser. It is a narrow one — read a footer,
// return a form key and a page number — but it can be wrong, which is exactly
// why the self-check exists.

import { modelFor, textFrom } from './_models.js';

// Claude reads PDFs (document block) and raster images (image block). TIFF and
// anything else cannot be sent; callers record those pages as skipped.
export const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif']);

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

// btoa over a large byte array blows the call stack — chunk the binary string
// and encode once. Single home for what used to be four near-identical copies.
export function bytesToBase64(bytes) {
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

// The content block for one file, or null if Claude cannot read the type.
export function contentBlockFor(contentType, base64) {
  if (contentType === 'application/pdf') {
    return { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64 } };
  }
  if (IMAGE_TYPES.has(contentType)) {
    return { type: 'image', source: { type: 'base64', media_type: contentType, data: base64 } };
  }
  return null;
}

// Models like to wrap JSON in fences no matter how firmly they are told not to.
export function stripFences(text) {
  return String(text).trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim();
}

/**
 * Segment one or more documents into a per-page form map.
 *
 * documents  [{ label, contentBlock }] in order; index is the source_document_index
 *            the model is told to echo back.
 * candidates [{ form_key, label?, edition_date? }] — the closed world.
 * role       model role (see _models.js). 'reason' by default because footer
 *            routing needs real reading; a caller running this over a 100-page
 *            package on a budget can drop it to 'extract'.
 *
 * Returns { pages, usage }. Throws on failure, tagging err.kind as 'api' or
 * 'parse' so callers can keep saying different things about the two — callers
 * decide whether a failure is fatal or degradable.
 */
export async function segmentPackage(env, { documents, candidates, role = 'reason' }) {
  const usable = (documents || []).filter(d => d.contentBlock);
  if (!usable.length) throw new Error('No document could be read as a PDF or image.');

  const candidateLines = (candidates || []).map(c => {
    const ed = c.edition_date ? ` — expected edition ${c.edition_date}` : '';
    const label = c.label ? ` (${c.label})` : '';
    return `- ${c.form_key}${label}${ed}`;
  }).join('\n');

  const content = [];
  documents.forEach((d, idx) => {
    if (!d.contentBlock) return;   // index still counts, so numbering stays stable
    content.push({ type: 'text', text: `=== DOCUMENT ${idx}: ${d.label || 'document'} ===` });
    content.push(d.contentBlock);
  });
  content.push({
    type: 'text',
    text: `CANDIDATE FORMS (the only forms in this matter's package):\n${candidateLines}\n\nAnalyze every page of every document above and return the JSON described in the system prompt. Use the DOCUMENT number shown before each file as source_document_index.`,
  });

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key':         env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model: modelFor(role, env),
      // Sonnet 5 runs adaptive thinking when this is omitted, where Sonnet 4.6
      // did not. Reading a footer is not the kind of work that needs
      // deliberation, and Package Builder calls this synchronously on the
      // request path behind a multi-megabyte upload — so keep it off.
      thinking:   { type: 'disabled' },
      max_tokens: 4096,
      system:     SYSTEM_PROMPT,
      messages:   [{ role: 'user', content }],
    }),
  });

  if (!res.ok) throw tagged('api', `Claude API ${res.status}: ${(await res.text()).slice(0, 500)}`);

  const data    = await res.json();
  const rawText = textFrom(data);
  let parsed;
  try { parsed = JSON.parse(stripFences(rawText)); }
  catch { throw tagged('parse', `Segmenter returned unparseable JSON: ${rawText.slice(0, 500)}`); }
  if (!parsed || !Array.isArray(parsed.pages)) {
    throw tagged('parse', 'Segmenter returned no pages array.');
  }

  return { pages: parsed.pages, usage: data?.usage ?? null };
}

function tagged(kind, message) {
  const err = new Error(message);
  err.kind = kind;
  return err;
}

/**
 * Collapse the per-page rows into one span per form: where it starts, where it
 * ends, and which of its own page numbers were actually seen.
 *
 * Pages the model could not route (form_key null) are not a span — they are the
 * evidence remainder, returned separately, because that boundary is exactly
 * what evidence review needs (PROOF-SCAN-HANDOFF.md §5).
 */
export function spansFrom(pages) {
  const byForm = new Map();
  const unrouted = [];

  (pages || []).forEach((p, i) => {
    const key = p?.form_key ? String(p.form_key).toLowerCase() : null;
    if (!key) { unrouted.push(i); return; }
    if (!byForm.has(key)) {
      byForm.set(key, { form_key: key, start: i, end: i, seen: new Set(), total: p.form_total_pages ?? null });
    }
    const span = byForm.get(key);
    span.end = i;
    if (Number.isInteger(p.form_page_number)) span.seen.add(p.form_page_number);
    if (span.total == null && Number.isInteger(p.form_total_pages)) span.total = p.form_total_pages;
  });

  return {
    spans: [...byForm.values()]
      .map(s => ({ ...s, seen: [...s.seen].sort((a, b) => a - b) }))
      .sort((a, b) => a.start - b.start),
    unrouted,
  };
}

/**
 * The self-check. Compares what the segmenter claims against what is already
 * known, with no model involved:
 *
 *   • missing  — the form's expected page count is known and pages are absent
 *   • extra    — a page number beyond the form's expected count
 *   • disputed — the footer's own "of Y" disagrees with form_editions
 *
 * expectedPages is { 'i-485': 24, … }, lowercased. A form not in it yields no
 * findings rather than a guess: an unknown expected count is not evidence of
 * anything, and inventing a complaint from it is how false positives start.
 */
export function checkSpans(spans, expectedPages = {}) {
  const findings = [];

  for (const span of spans || []) {
    const expected = expectedPages[span.form_key];
    const seen = span.seen || [];

    if (Number.isInteger(span.total) && Number.isInteger(expected) && span.total !== expected) {
      findings.push({
        form_key: span.form_key, type: 'disputed',
        detail: `The footer says this form has ${span.total} pages; the current edition has ${expected}.`,
      });
    }

    if (!Number.isInteger(expected)) continue;

    const extra = seen.filter(n => n > expected);
    if (extra.length) {
      findings.push({
        form_key: span.form_key, type: 'extra',
        detail: `Page ${extra.join(', ')} is beyond the ${expected} pages this form has.`,
      });
    }

    // Only report absences once at least one page of the form was identified —
    // a form nobody filed is not a form with missing pages.
    if (seen.length) {
      const missing = [];
      for (let n = 1; n <= expected; n++) if (!seen.includes(n)) missing.push(n);
      if (missing.length) {
        findings.push({
          form_key: span.form_key, type: 'missing',
          detail: `Page ${missing.join(', ')} of ${expected} ${missing.length === 1 ? 'was' : 'were'} not found.`,
        });
      }
    }
  }

  return findings;
}
