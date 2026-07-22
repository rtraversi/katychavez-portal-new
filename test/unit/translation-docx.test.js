// Unit tests for the translation DOCX builder — blocks parsing, language
// auto-detect passthrough, and the certification toggle.
import { describe, it, expect } from 'vitest';
import {
  parseBlocks,
  blocksToText,
  certificationText,
  buildTranslationDocx,
} from '../../functions/utils/translation-docx.js';

const SAMPLE = JSON.stringify({
  format: 'blocks-v1',
  source_language: 'Portuguese',
  blocks: [
    { type: 'title', text: 'BIRTH CERTIFICATE' },
    { type: 'fields', rows: [[{ label: 'NAME', value: 'MARIA SILVA' }]] },
    { type: 'paragraph', text: 'Narrative text.' },
  ],
});

describe('parseBlocks', () => {
  it('parses valid blocks-v1 JSON and keeps source_language', () => {
    const parsed = parseBlocks(SAMPLE);
    expect(parsed).not.toBeNull();
    expect(parsed.source_language).toBe('Portuguese');
    expect(parsed.blocks).toHaveLength(3);
  });
  it('strips markdown fences', () => {
    expect(parseBlocks('```json\n' + SAMPLE + '\n```')).not.toBeNull();
  });
  it('returns null for legacy flat text', () => {
    expect(parseBlocks('CERTIFICATE\nPlain text translation')).toBeNull();
  });
});

describe('blocksToText', () => {
  it('flattens titles, fields, and paragraphs', () => {
    const text = blocksToText(parseBlocks(SAMPLE).blocks);
    expect(text).toContain('BIRTH CERTIFICATE');
    expect(text).toContain('NAME: MARIA SILVA');
    expect(text).toContain('Narrative text.');
  });
});

describe('certificationText', () => {
  it('uses the detected source language', () => {
    expect(certificationText('Jane Doe', 'Portuguese'))
      .toContain('competent to translate from Portuguese to English');
  });
  it('defaults to Spanish for legacy rows without source_language', () => {
    expect(certificationText('Jane Doe', undefined))
      .toContain('competent to translate from Spanish to English');
  });
  it('falls back to a signature line when no translator name given', () => {
    expect(certificationText('', 'Spanish')).toContain('I, _________________________,');
  });
});

describe('buildTranslationDocx certification toggle', () => {
  it('builds without throwing, with and without certification', () => {
    expect(() => buildTranslationDocx(SAMPLE, 'Jane Doe', true)).not.toThrow();
    expect(() => buildTranslationDocx(SAMPLE, 'Jane Doe', false)).not.toThrow();
    expect(() => buildTranslationDocx(SAMPLE, 'Jane Doe')).not.toThrow(); // default true
  });

  it('produces a smaller document when certification is omitted', async () => {
    const { Packer } = await import('docx');
    const withCert    = await Packer.toBase64String(buildTranslationDocx(SAMPLE, 'Jane Doe', true));
    const withoutCert = await Packer.toBase64String(buildTranslationDocx(SAMPLE, 'Jane Doe', false));
    expect(withoutCert.length).toBeLessThan(withCert.length);
  });

  it('handles legacy flat text without throwing', () => {
    expect(() => buildTranslationDocx('Plain legacy translation text', 'Jane Doe', false)).not.toThrow();
  });
});
