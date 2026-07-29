// Unit tests for the Case Builder pure helpers (migrations 1620-1621).
//
// These cover the rules that are easy to get subtly wrong and that the API
// depends on: deriving a stable snake_case key from a human name, resolving key
// collisions within a practice area, and the hyphen-insensitive form search that
// lets "i130" find "i-130".
import { describe, it, expect } from 'vitest';
import { slugify, uniqueKey, normalizeSearch, matchesQuery } from '../../functions/api/_case-builder.js';

describe('slugify', () => {
  it('lowercases and snake_cases a display name', () => {
    expect(slugify('Adjustment of Status')).toBe('adjustment_of_status');
  });
  it('collapses punctuation and runs of separators to a single underscore', () => {
    expect(slugify('Certificate of Citizenship (N-600)')).toBe('certificate_of_citizenship_n_600');
  });
  it('trims leading/trailing separators', () => {
    expect(slugify('  --Green Card--  ')).toBe('green_card');
  });
  it('strips accents', () => {
    expect(slugify('Petición Familiar')).toBe('peticion_familiar');
  });
  it('returns empty string when there is nothing alphanumeric', () => {
    expect(slugify('!!! ---')).toBe('');
    expect(slugify(null)).toBe('');
  });
});

describe('uniqueKey', () => {
  it('returns the base when it is free', () => {
    expect(uniqueKey('aos', ['naturalization', 'daca'])).toBe('aos');
  });
  it('suffixes _2 on first collision', () => {
    expect(uniqueKey('aos', ['aos'])).toBe('aos_2');
  });
  it('skips already-taken numbered suffixes', () => {
    expect(uniqueKey('aos', ['aos', 'aos_2', 'aos_3'])).toBe('aos_4');
  });
  it('tolerates an empty/undefined existing list', () => {
    expect(uniqueKey('aos', undefined)).toBe('aos');
  });
});

describe('normalizeSearch', () => {
  it('strips all non-alphanumerics and lowercases', () => {
    expect(normalizeSearch('I-130')).toBe('i130');
    expect(normalizeSearch('i 130')).toBe('i130');
    expect(normalizeSearch('I130')).toBe('i130');
  });
});

describe('matchesQuery', () => {
  const tmpl = { form_key: 'i-130', label: 'Petition for Alien Relative', agency: 'USCIS' };

  it('matches a form code regardless of hyphen/spacing', () => {
    expect(matchesQuery(tmpl, 'i130')).toBe(true);
    expect(matchesQuery(tmpl, 'i-130')).toBe(true);
    expect(matchesQuery(tmpl, 'I 130')).toBe(true);
  });
  it('matches on words in the label', () => {
    expect(matchesQuery(tmpl, 'alien')).toBe(true);
    expect(matchesQuery(tmpl, 'relative')).toBe(true);
  });
  it('matches on agency', () => {
    expect(matchesQuery(tmpl, 'uscis')).toBe(true);
  });
  it('does not match unrelated text', () => {
    expect(matchesQuery(tmpl, 'i485')).toBe(false);
  });
  it('an empty query matches everything (no filter applied)', () => {
    expect(matchesQuery(tmpl, '')).toBe(true);
    expect(matchesQuery(tmpl, '   ')).toBe(true);
  });
});
