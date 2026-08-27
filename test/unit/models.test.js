// Unit tests for functions/api/_models.js — model selection + response reading.
//
// Both halves of this module exist because of a bug class that is invisible until
// production: a model id pinned at six separate call sites had drifted a
// generation behind, and every one of those sites read `content[0].text`, which
// silently returns nothing the moment a model runs adaptive thinking (Sonnet 5
// and Opus 5 do by default; Sonnet 4.6 did not). Neither failure raises — one
// costs money quietly, the other returns empty reports.
import { describe, it, expect } from 'vitest';
import { modelFor, textFrom, MODELS } from '../../functions/api/_models.js';

describe('modelFor', () => {
  it('returns the default for each known role', () => {
    for (const role of Object.keys(MODELS)) {
      expect(modelFor(role, {})).toBe(MODELS[role]);
    }
  });

  it('works with no env at all', () => {
    expect(modelFor('judge')).toBe(MODELS.judge);
    expect(modelFor('judge', undefined)).toBe(MODELS.judge);
  });

  it('lets a Worker var override one role without touching the others', () => {
    const env = { MODEL_JUDGE: 'claude-opus-4-8' };
    expect(modelFor('judge', env)).toBe('claude-opus-4-8');
    expect(modelFor('reason', env)).toBe(MODELS.reason);
  });

  it('ignores an override that is empty or whitespace', () => {
    expect(modelFor('chat', { MODEL_CHAT: '' })).toBe(MODELS.chat);
    expect(modelFor('chat', { MODEL_CHAT: '   ' })).toBe(MODELS.chat);
  });

  it('throws on an unknown role rather than defaulting to a tier', () => {
    // A typo must fail at the call site, not quietly route to the wrong model.
    expect(() => modelFor('reasoning', {})).toThrow(/Unknown model role/);
  });

  it('pins Haiku to its dated id — there is no undated alias published', () => {
    expect(MODELS.extract).toBe('claude-haiku-4-5-20251001');
    expect(MODELS.chat).toBe('claude-haiku-4-5-20251001');
  });
});

describe('textFrom', () => {
  it('reads a plain text-only response', () => {
    expect(textFrom({ content: [{ type: 'text', text: 'hello' }] })).toBe('hello');
  });

  it('skips a leading thinking block — the regression this exists to prevent', () => {
    const msg = { content: [
      { type: 'thinking', thinking: 'let me consider the footers…' },
      { type: 'text', text: '<div>report</div>' },
    ] };
    expect(textFrom(msg)).toBe('<div>report</div>');
    expect(msg.content[0].text).toBeUndefined();   // what the old code read
  });

  it('returns empty string rather than throwing on junk', () => {
    expect(textFrom(undefined)).toBe('');
    expect(textFrom({})).toBe('');
    expect(textFrom({ content: [] })).toBe('');
    expect(textFrom({ content: 'nope' })).toBe('');
    expect(textFrom({ content: [{ type: 'thinking', thinking: 'x' }] })).toBe('');
  });
});
