// Unit tests for the pure logic of the form-edition staleness guard
// (functions/api/process-form-edition-check.js). No network or DB — the scrape
// parsing and the verdict logic are pure and run in workerd with the suite.
//
// The single most important property under test: the guard NEVER reports a form
// as 'current' unless it positively parsed a matching edition. A page that
// changed shape, or a fetch that failed, must land on 'error' — an alert — not a
// silent pass. A scraper that quietly stops working is worse than no scraper.

import { describe, it, expect } from 'vitest';
import { extractEdition, evaluate } from '../../functions/api/process-form-edition-check.js';

describe('extractEdition', () => {
  it('reads the date after an "Edition Date" label', () => {
    expect(extractEdition('<div>Edition Date 04/01/24</div>')).toBe('04/01/24');
  });

  it('reads through markup between the label and the date', () => {
    expect(extractEdition('<dt>Edition Date</dt><dd><span>10/17/24</span></dd>')).toBe('10/17/24');
  });

  it('is case-insensitive on the label', () => {
    expect(extractEdition('EDITION DATE: 08/21/25')).toBe('08/21/25');
  });

  it('does not grab a date that appears before the label (e.g. a "related forms" list)', () => {
    // A date far above the label must not be captured; only text after it counts.
    const html = 'Some other form 01/01/99 ... more text ... Edition Date 04/01/24';
    expect(extractEdition(html)).toBe('04/01/24');
  });

  it('skips a prose "edition date" mention and finds the real labelled value', () => {
    // The real USCIS I-90 page: boilerplate ("find the edition date at the
    // bottom of the page") appears BEFORE the actual "Edition Date 01/20/25"
    // field. The first label has no date near it and must be skipped.
    const html = 'You can find the edition date at the bottom of the page on the form. ' +
                 'Lorem ipsum blah blah more sentences here padding it out well past forty characters. ' +
                 'Edition Date 01/20/25';
    expect(extractEdition(html)).toBe('01/20/25');
  });

  it('returns null when there is no edition label at all', () => {
    expect(extractEdition('<h1>Form I-130</h1><p>no edition here</p>')).toBeNull();
  });

  it('returns null on empty/garbage input', () => {
    expect(extractEdition('')).toBeNull();
    expect(extractEdition(null)).toBeNull();
  });
});

describe('evaluate', () => {
  const row = { form_number: 'I-130', edition_date: '04/01/24' };

  it('is "current" only when the upstream edition matches ours', () => {
    const v = evaluate(row, { html: 'Edition Date 04/01/24' });
    expect(v.check_status).toBe('current');
    expect(v.upstream_edition).toBe('04/01/24');
    expect(v.check_error).toBeNull();
  });

  it('matches across 2- vs 4-digit years', () => {
    expect(evaluate(row, { html: 'Edition Date 04/01/2024' }).check_status).toBe('current');
  });

  it('is "stale" when upstream differs from ours', () => {
    const v = evaluate(row, { html: 'Edition Date 10/01/25' });
    expect(v.check_status).toBe('stale');
    expect(v.upstream_edition).toBe('10/01/25');
  });

  it('is "error" — never "current" — when the page has no parseable edition', () => {
    const v = evaluate(row, { html: '<h1>I-130</h1> bot-check page' });
    expect(v.check_status).toBe('error');
    expect(v.upstream_edition).toBeNull();
    expect(v.check_error).toMatch(/no edition/i);
  });

  it('is "error" when the fetch failed', () => {
    const v = evaluate(row, { error: 'HTTP 503' });
    expect(v.check_status).toBe('error');
    expect(v.check_error).toMatch(/503/);
  });
});
