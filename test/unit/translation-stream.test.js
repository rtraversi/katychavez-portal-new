// Unit tests for the Anthropic SSE stream accumulator used by
// /api/translation-process.
import { describe, it, expect } from 'vitest';
import { createSseAccumulator } from '../../functions/utils/anthropic-stream.js';

const evt = (type, payload) =>
  `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;

describe('createSseAccumulator', () => {
  it('concatenates text deltas in order', () => {
    const acc = createSseAccumulator();
    acc.push(evt('message_start', { message: {} }));
    acc.push(evt('content_block_delta', { delta: { type: 'text_delta', text: '{"format":' } }));
    acc.push(evt('content_block_delta', { delta: { type: 'text_delta', text: '"blocks-v1"}' } }));
    expect(acc.text()).toBe('{"format":"blocks-v1"}');
    expect(acc.error()).toBeNull();
  });

  it('handles events split across arbitrary chunk boundaries', () => {
    const acc = createSseAccumulator();
    const full = evt('content_block_delta', { delta: { type: 'text_delta', text: 'Hello world' } });
    // Feed one character at a time — worst-case network fragmentation.
    for (const ch of full) acc.push(ch);
    expect(acc.text()).toBe('Hello world');
  });

  it('captures stop_reason from message_delta', () => {
    const acc = createSseAccumulator();
    acc.push(evt('content_block_delta', { delta: { type: 'text_delta', text: 'x' } }));
    acc.push(evt('message_delta', { delta: { stop_reason: 'max_tokens' }, usage: {} }));
    expect(acc.stopReason()).toBe('max_tokens');
  });

  it('surfaces stream errors', () => {
    const acc = createSseAccumulator();
    acc.push(evt('error', { error: { type: 'overloaded_error', message: 'Overloaded' } }));
    expect(acc.error()).toBe('Overloaded');
  });

  it('ignores pings, comments, and malformed data lines', () => {
    const acc = createSseAccumulator();
    acc.push('event: ping\ndata: {"type":"ping"}\n\n');
    acc.push(': keep-alive comment\n\n');
    acc.push('data: not-json\n\n');
    acc.push(evt('content_block_delta', { delta: { type: 'text_delta', text: 'ok' } }));
    expect(acc.text()).toBe('ok');
    expect(acc.error()).toBeNull();
  });

  it('ignores non-text deltas (input_json_delta etc.)', () => {
    const acc = createSseAccumulator();
    acc.push(evt('content_block_delta', { delta: { type: 'input_json_delta', partial_json: '{}' } }));
    expect(acc.text()).toBe('');
  });
});
