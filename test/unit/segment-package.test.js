// Unit tests for the shared package segmenter (functions/api/_segment-package.js).
//
// The model call itself isn't tested here — it needs a network and an API key.
// What IS tested is everything around it that decides whether a page map can be
// trusted: collapsing per-page rows into spans, and the self-check that compares
// those spans against page counts we already know from form_editions.
//
// That self-check is the reason this module is worth sharing. It is the one part
// of proof scan's segmentation that involves no model judgment at all, so it is
// the part that must not drift — and the part where a wrong rule would generate
// exactly the false positives the whole revamp exists to remove.
import { describe, it, expect } from 'vitest';
import {
  spansFrom, checkSpans, bytesToBase64, stripFences, contentBlockFor,
} from '../../functions/api/_segment-package.js';

// One page row as the segmenter returns it; only the fields spansFrom reads.
const page = (form_key, form_page_number, form_total_pages = null) =>
  ({ form_key, form_page_number, form_total_pages });

describe('spansFrom', () => {
  it('collapses consecutive pages of one form into a span', () => {
    const { spans } = spansFrom([page('i-765', 1), page('i-765', 2), page('i-765', 3)]);
    expect(spans).toHaveLength(1);
    expect(spans[0]).toMatchObject({ form_key: 'i-765', start: 0, end: 2, seen: [1, 2, 3] });
  });

  it('keeps forms apart and orders spans by where they start', () => {
    const { spans } = spansFrom([page('i-485', 1), page('i-485', 2), page('g-28', 1)]);
    expect(spans.map(s => s.form_key)).toEqual(['i-485', 'g-28']);
  });

  it('separates the pages it could not route — that is the evidence remainder', () => {
    // The forms/evidence boundary falls out of segmentation for free, which is
    // what evidence review needs (PROOF-SCAN-HANDOFF.md §5).
    const { spans, unrouted } = spansFrom([page('i-130', 1), page(null, null), page(null, null)]);
    expect(spans).toHaveLength(1);
    expect(unrouted).toEqual([1, 2]);
  });

  it('normalizes form key case so I-765 and i-765 are one span', () => {
    const { spans } = spansFrom([page('I-765', 1), page('i-765', 2)]);
    expect(spans).toHaveLength(1);
    expect(spans[0].form_key).toBe('i-765');
  });

  it('survives a form whose pages are interleaved with another', () => {
    // A real package can have a signature page filed out of order; the span
    // still has to cover it rather than starting a second span.
    const { spans } = spansFrom([page('i-765', 1), page('g-28', 1), page('i-765', 2)]);
    const ws = spans.find(s => s.form_key === 'i-765');
    expect(ws).toMatchObject({ start: 0, end: 2, seen: [1, 2] });
  });
});

describe('checkSpans', () => {
  const expected = { 'i-765': 7, 'i-485': 24 };

  it('says nothing about a complete form', () => {
    const { spans } = spansFrom([1, 2, 3, 4, 5, 6, 7].map(n => page('i-765', n)));
    expect(checkSpans(spans, expected)).toEqual([]);
  });

  it('names the pages that are missing', () => {
    const { spans } = spansFrom([1, 2, 3, 5, 6, 7].map(n => page('i-765', n)));
    const [f] = checkSpans(spans, expected);
    expect(f).toMatchObject({ form_key: 'i-765', type: 'missing' });
    expect(f.detail).toContain('4');
  });

  it('flags a page number beyond the form’s length', () => {
    const { spans } = spansFrom([page('i-765', 1), page('i-765', 9)]);
    const extra = checkSpans(spans, expected).find(f => f.type === 'extra');
    expect(extra.detail).toContain('9');
  });

  it('reports a footer that disagrees with the current edition’s page count', () => {
    // The classic old-signature-page case: the page is from an edition that had
    // a different length, and its own footer says so.
    const { spans } = spansFrom([page('i-765', 1, 5)]);
    const disputed = checkSpans(spans, expected).find(f => f.type === 'disputed');
    expect(disputed.detail).toContain('5');
    expect(disputed.detail).toContain('7');
  });

  it('stays silent on a form whose expected page count is unknown', () => {
    // An unknown expected count is not evidence of anything. Guessing from it is
    // precisely how invented findings get in.
    const { spans } = spansFrom([page('i-9999', 1), page('i-9999', 4)]);
    expect(checkSpans(spans, expected)).toEqual([]);
  });

  it('does not claim a form is incomplete when none of it was found', () => {
    // No pages of a form is a form that was not filed, not 24 missing pages.
    expect(checkSpans([{ form_key: 'i-485', start: 0, end: 0, seen: [], total: null }], expected))
      .toEqual([]);
  });

  it('tolerates empty and missing input', () => {
    expect(checkSpans([], expected)).toEqual([]);
    expect(checkSpans(undefined, expected)).toEqual([]);
    expect(checkSpans(spansFrom([]).spans)).toEqual([]);
  });
});

describe('content helpers', () => {
  it('builds a document block for PDFs and an image block for rasters', () => {
    expect(contentBlockFor('application/pdf', 'AAAA')).toMatchObject({
      type: 'document', source: { media_type: 'application/pdf', data: 'AAAA' },
    });
    expect(contentBlockFor('image/png', 'AAAA')).toMatchObject({ type: 'image' });
  });

  it('returns null for a type Claude cannot read, so callers can skip it', () => {
    expect(contentBlockFor('image/tiff', 'AAAA')).toBeNull();
    expect(contentBlockFor('application/msword', 'AAAA')).toBeNull();
  });

  it('strips the code fences models add no matter how firmly told not to', () => {
    expect(stripFences('```json\n{"pages":[]}\n```')).toBe('{"pages":[]}');
    expect(stripFences('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripFences('{"a":1}')).toBe('{"a":1}');
  });

  it('encodes large byte arrays without blowing the call stack', () => {
    const bytes = new Uint8Array(300_000).fill(0x41);
    expect(bytesToBase64(bytes).length).toBe(Math.ceil(bytes.length / 3) * 4);
  });
});
