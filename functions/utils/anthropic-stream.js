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
