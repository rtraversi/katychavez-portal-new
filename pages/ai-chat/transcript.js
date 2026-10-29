// transcript.js: stored message content → what the page shows. Pure; no DOM.
//
// An assistant row's content is the API's block list: thinking (a readable
// summary, since the Worker asks for display "summarized"), server_tool_use
// (web searches), web_search_tool_result, and text blocks, some carrying
// citations. The answer is the text blocks joined in order; a cited block gets
// a numbered marker after it, and the cited pages become the Sources list.

import { citeToken } from './markdown.js';

export function assistantView(content) {
  const blocks = Array.isArray(content) ? content : [];
  const sources = [];
  const byUrl = new Map();
  const thinking = [];
  const searches = [];
  let text = '';

  for (const b of blocks) {
    if (b?.type === 'thinking' && b.thinking?.trim()) thinking.push(b.thinking.trim());
    else if (b?.type === 'server_tool_use' && b.name === 'web_search' && b.input?.query) searches.push(String(b.input.query));
    else if (b?.type === 'text' && typeof b.text === 'string') {
      text += b.text;
      const nums = [];
      for (const c of b.citations || []) {
        if (!c?.url) continue;
        let n = byUrl.get(c.url);
        if (!n) {
          n = sources.length + 1;
          byUrl.set(c.url, n);
          sources.push({ n, url: c.url, title: c.title || hostOf(c.url) });
        }
        if (!nums.includes(n)) nums.push(n);
      }
      // Markers go after any trailing whitespace so they never split a line ending.
      if (nums.length) {
        const m = text.match(/\s*$/);
        const tail = m ? m[0] : '';
        text = text.slice(0, text.length - tail.length) + nums.map(citeToken).join('') + tail;
      }
    }
  }
  return { text, sources, thinking: thinking.join('\n\n'), searches };
}

// The plain answer, for the copy button: no markers, sources appended.
export function plainAnswer(content) {
  const { text, sources } = assistantView(content);
  const body = text.replace(/\u0000CITE\d+\u0000/g, '').trim();
  if (!sources.length) return body;
  return `${body}\n\nSources:\n${sources.map((s) => `${s.n}. ${s.title} – ${s.url}`).join('\n')}`;
}

export function userView(content) {
  const blocks = Array.isArray(content) ? content : [];
  return {
    text: blocks.filter((b) => b?.type === 'text').map((b) => b.text).join('\n\n'),
    attachmentIds: blocks.filter((b) => b?.type === 'attachment').map((b) => b.attachment_id),
  };
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return url; }
}

export function fmtBytes(n) {
  const v = Number(n) || 0;
  if (v < 1024) return `${v} B`;
  if (v < 1024 * 1024) return `${(v / 1024).toFixed(v < 10 * 1024 ? 1 : 0)} KB`;
  if (v < 1024 ** 3) return `${(v / 1024 / 1024).toFixed(v < 10 * 1024 * 1024 ? 1 : 0)} MB`;
  return `${(v / 1024 ** 3).toFixed(2)} GB`;
}

// Splits a fetch body of newline-delimited JSON into events across chunks.
export function createNdjsonReader(onEvent) {
  let buf = '';
  return {
    push(chunk) {
      buf += chunk;
      let idx;
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, idx).trim();
        buf = buf.slice(idx + 1);
        if (!line) continue;
        try { onEvent(JSON.parse(line)); } catch { /* skip a malformed line */ }
      }
    },
    end() {
      const line = buf.trim();
      buf = '';
      if (line) { try { onEvent(JSON.parse(line)); } catch { /* ignore */ } }
    },
  };
}
