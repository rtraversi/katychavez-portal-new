// anthropic-stream.js — minimal SSE accumulator for Anthropic Messages
// streaming responses. Streaming keeps bytes flowing for the whole generation,
// which is what lets a multi-minute translation survive where a single
// non-streaming request gets dropped.
//
// Usage:
//   const acc = createSseAccumulator();
//   for await (chunk of response) acc.push(decoder.decode(chunk, {stream:true}));
//   acc.text()        → concatenated text deltas
//   acc.stopReason()  → 'end_turn' | 'max_tokens' | … | null
//   acc.usage()       → { input_tokens, output_tokens, … } accumulated, or {}
//   acc.error()       → error message string, or null
//   acc.model()       → the model that answered (message_start), or null

export function createSseAccumulator() {
  let buffer = '';
  let text = '';
  let stopReason = null;
  let errorMsg = null;
  let usage = {};
  let model = null;

  const handleData = (jsonStr) => {
    if (!jsonStr || jsonStr === '[DONE]') return;
    let evt;
    try { evt = JSON.parse(jsonStr); } catch { return; }
    if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
      text += evt.delta.text || '';
    } else if (evt.type === 'message_delta') {
      if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
      // Token counts arrive here, not on the final event — a streamed call has
      // no response body to read usage off, so anything that records cost has
      // to pick it up in passing.
      if (evt.usage) usage = { ...usage, ...evt.usage };
    } else if (evt.type === 'message_start') {
      if (evt.message?.model) model = evt.message.model;
      if (evt.message?.usage) usage = { ...usage, ...evt.message.usage };
    } else if (evt.type === 'error') {
      errorMsg = evt.error?.message || 'stream error';
    }
  };

  return {
    push(chunk) {
      buffer += chunk;
      // SSE events are separated by a blank line; keep the trailing partial.
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of rawEvent.split('\n')) {
          if (line.startsWith('data:')) handleData(line.slice(5).trim());
        }
      }
    },
    text:       () => text,
    stopReason: () => stopReason,
    usage:      () => usage,
    error:      () => errorMsg,
    model:      () => model,
  };
}

// Drives a fetch() Response body through the accumulator.
export async function readSseStream(response) {
  const acc = createSseAccumulator();
  const decoder = new TextDecoder();
  const reader = response.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    acc.push(decoder.decode(value, { stream: true }));
  }
  acc.push(decoder.decode()); // flush
  return acc;
}

// ── Whole-message assembly ────────────────────────────────────────────────────
// createSseAccumulator keeps only the text. A multi-turn chat needs the reply's
// full content blocks: each later request resends the history, and the API
// requires thinking blocks (with their signatures) and web search blocks back
// exactly as they came. This rebuilds them from the stream.
//
//   const asm = createMessageAssembler({ onEvent(evt, block) { … } });
//   asm.push(chunk) …
//   asm.blocks()      → content blocks, ready to store and resend
//   asm.stopReason() / asm.usage() / asm.error() / asm.model()  as above
//
// onEvent sees every parsed event after it is applied; `block` is the block the
// event touched (complete by content_block_stop), so a caller can forward text
// deltas or report a finished search query as it happens.
export function createMessageAssembler({ onEvent } = {}) {
  let buffer = '';
  const blocks = [];
  const partialJson = new Map();   // block index → tool input JSON so far
  let stopReason = null;
  let errorMsg = null;
  let usage = {};
  let model = null;

  const handleData = (jsonStr) => {
    if (!jsonStr || jsonStr === '[DONE]') return;
    let evt;
    try { evt = JSON.parse(jsonStr); } catch { return; }
    let block = null;
    switch (evt.type) {
      case 'message_start':
        if (evt.message?.model) model = evt.message.model;
        if (evt.message?.usage) usage = { ...usage, ...evt.message.usage };
        break;
      case 'content_block_start': {
        block = { ...evt.content_block };
        // Tool inputs arrive as JSON deltas; the start event's `input: {}` is a placeholder.
        if (block.type === 'tool_use' || block.type === 'server_tool_use') partialJson.set(evt.index, '');
        blocks[evt.index] = block;
        break;
      }
      case 'content_block_delta': {
        block = blocks[evt.index];
        const d = evt.delta || {};
        if (!block) break;
        if (d.type === 'text_delta') block.text = (block.text || '') + (d.text || '');
        else if (d.type === 'thinking_delta') block.thinking = (block.thinking || '') + (d.thinking || '');
        else if (d.type === 'signature_delta') block.signature = (block.signature || '') + (d.signature || '');
        else if (d.type === 'input_json_delta') partialJson.set(evt.index, (partialJson.get(evt.index) || '') + (d.partial_json || ''));
        else if (d.type === 'citations_delta' && d.citation) (block.citations ||= []).push(d.citation);
        break;
      }
      case 'content_block_stop': {
        block = blocks[evt.index];
        if (block && partialJson.has(evt.index)) {
          const raw = partialJson.get(evt.index);
          partialJson.delete(evt.index);
          try { block.input = raw ? JSON.parse(raw) : {}; } catch { block.input = {}; }
        }
        // A text block opens with `citations: null` when none follow; drop it
        // rather than resend a null the API never needed.
        if (block?.type === 'text' && block.citations == null) delete block.citations;
        break;
      }
      case 'message_delta':
        if (evt.delta?.stop_reason) stopReason = evt.delta.stop_reason;
        if (evt.usage) usage = { ...usage, ...evt.usage };
        break;
      case 'error':
        errorMsg = evt.error?.message || 'stream error';
        break;
      default:
        break;
    }
    if (onEvent) onEvent(evt, block);
  };

  return {
    push(chunk) {
      buffer += chunk;
      let idx;
      while ((idx = buffer.indexOf('\n\n')) !== -1) {
        const rawEvent = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of rawEvent.split('\n')) {
          if (line.startsWith('data:')) handleData(line.slice(5).trim());
        }
      }
    },
    blocks:     () => blocks.filter(Boolean),
    stopReason: () => stopReason,
    usage:      () => usage,
    error:      () => errorMsg,
    model:      () => model,
  };
}
