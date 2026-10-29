// markdown.js: the small Markdown subset Claude writes, rendered to safe HTML.
//
// Safety comes from order: every piece of source text is HTML-escaped before
// any formatting is applied, and the only tags emitted are the fixed ones
// below. Links are kept only for http(s) and mailto. Nothing from a reply can
// become live markup.
//
// Covered: paragraphs (single newlines become <br>), # headings, **bold**,
// *italic*, `code`, fenced code, nested - / 1. lists, > quotes, --- rules,
// [links](https://…) and pipe tables. Anything else shows as its plain text.
//
// Citation markers: a caller may put CITE(n) placeholders, built with
// citeToken(n), in the source; renderMarkdown swaps them for the HTML that
// `cite(n)` returns. They pass through escaping untouched.

const CITE_RE = /\u0000CITE(\d+)\u0000/g;
export const citeToken = (n) => `\u0000CITE${n}\u0000`;

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

const LIST_RE = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const FENCE_RE = /^\s*(```|~~~)/;
const HEADING_RE = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const HR_RE = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const QUOTE_RE = /^\s{0,3}>\s?/;
const TABLE_SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;

const indentOf = (line) => line.match(/^\s*/)[0].replace(/\t/g, '    ').length;

export function renderMarkdown(text, { cite } = {}) {
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  let html = renderBlocks(lines);
  html = html.replace(CITE_RE, (_, n) => (cite ? cite(Number(n)) : ''));
  return html;
}

function renderBlocks(lines) {
  const out = [];
  let para = [];
  const flush = () => {
    if (para.length) out.push(`<p>${para.map(inline).join('<br>')}</p>`);
    para = [];
  };

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (!line.trim()) { flush(); i++; continue; }

    if (FENCE_RE.test(line)) {
      flush();
      const fence = line.trim().slice(0, 3);
      const body = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith(fence)) body.push(lines[i++]);
      i++;   // closing fence (or end of text)
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    const h = HEADING_RE.exec(line);
    if (h) {
      flush();
      // Chat answers sit under the page's own headings: # → h3, ## → h4, deeper → h5.
      const level = Math.min(h[1].length + 2, 5);
      out.push(`<h${level}>${inline(h[2])}</h${level}>`);
      i++;
      continue;
    }

    if (HR_RE.test(line)) { flush(); out.push('<hr>'); i++; continue; }

    if (QUOTE_RE.test(line)) {
      flush();
      const body = [];
      while (i < lines.length && QUOTE_RE.test(lines[i])) body.push(lines[i++].replace(QUOTE_RE, ''));
      out.push(`<blockquote>${renderBlocks(body)}</blockquote>`);
      continue;
    }

    if (line.includes('|') && i + 1 < lines.length && TABLE_SEP_RE.test(lines[i + 1]) && lines[i + 1].includes('-')) {
      flush();
      const head = splitRow(line);
      const align = splitRow(lines[i + 1]).map((c) => (/^:-+:$/.test(c) ? 'center' : /-:$/.test(c) ? 'right' : ''));
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(splitRow(lines[i++]));
      const cell = (tag, c, k) => `<${tag}${align[k] ? ` style="text-align:${align[k]}"` : ''}>${inline(c)}</${tag}>`;
      out.push(`<div class="ac-table-wrap"><table><thead><tr>${head.map((c, k) => cell('th', c, k)).join('')}</tr></thead><tbody>${
        rows.map((r) => `<tr>${head.map((_, k) => cell('td', r[k] ?? '', k)).join('')}</tr>`).join('')
      }</tbody></table></div>`);
      continue;
    }

    if (LIST_RE.test(line)) {
      flush();
      const [listHtml, next] = parseList(lines, i);
      out.push(listHtml);
      i = next;
      continue;
    }

    para.push(line.trim());
    i++;
  }
  flush();
  return out.join('');
}

function splitRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
  return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
}

// One list at one indent. An item owns every following line indented deeper
// than its marker (its wrapped text and any nested list), including blank
// lines that sit between those.
function parseList(lines, start) {
  const first = LIST_RE.exec(lines[start]);
  const base = indentOf(first[1]);
  const ordered = /\d/.test(first[2]);
  const startNum = ordered ? Number.parseInt(first[2], 10) : 1;
  const items = [];
  let i = start;

  while (i < lines.length) {
    const m = LIST_RE.exec(lines[i]);
    if (!m || indentOf(m[1]) !== base || /\d/.test(m[2]) !== ordered) break;
    const head = m[3];
    const rest = [];
    i++;
    while (i < lines.length) {
      const l = lines[i];
      if (!l.trim()) {
        let j = i + 1;
        while (j < lines.length && !lines[j].trim()) j++;
        if (j < lines.length && indentOf(lines[j]) > base) { rest.push(''); i++; continue; }
        break;
      }
      if (indentOf(l) > base) { rest.push(l); i++; continue; }
      break;
    }
    items.push({ head, rest });

    // A blank line between two items of the same list keeps the list going.
    let j = i;
    while (j < lines.length && !lines[j].trim()) j++;
    const nm = j < lines.length ? LIST_RE.exec(lines[j]) : null;
    if (j > i && nm && indentOf(nm[1]) === base && /\d/.test(nm[2]) === ordered) i = j;
  }

  const lis = items.map(({ head, rest }) => {
    const nonBlank = rest.filter((l) => l.trim());
    if (!nonBlank.length) return `<li>${inline(head)}</li>`;
    const cut = Math.min(...nonBlank.map(indentOf));
    const inner = rest.map((l) => l.replace(/\t/g, '    ').slice(cut));
    // Wrapped text directly under the item continues its first line.
    const cont = [];
    while (inner.length && inner[0].trim() && !LIST_RE.test(inner[0]) && !FENCE_RE.test(inner[0])) cont.push(inner.shift().trim());
    const headHtml = [head, ...cont].map(inline).join('<br>');
    return `<li>${headHtml}${inner.some((l) => l.trim()) ? renderBlocks(inner) : ''}</li>`;
  }).join('');

  const tag = ordered ? 'ol' : 'ul';
  const startAttr = ordered && startNum !== 1 ? ` start="${startNum}"` : '';
  return [`<${tag}${startAttr}>${lis}</${tag}>`, i];
}

// Inline formatting on one line of source. Code spans are cut out first so
// nothing inside them is formatted.
function inline(src) {
  const codes = [];
  let s = String(src).replace(/`([^`]+)`/g, (_, c) => {
    codes.push(c);
    return `\u0001${codes.length - 1}\u0001`;
  });
  s = escapeHtml(s);

  s = s.replace(/\[([^\]]+)\]\(((?:https?:\/\/|mailto:)[^\s)]+)\)/g,
    (_, label, url) => `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`);
  // Bare URLs, outside any href or link text already made.
  s = s.replace(/(^|[\s(])(https?:\/\/[^\s<)]+[^\s<).,;:!?'"])/g,
    (_, pre, url) => `${pre}<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`);

  s = s.replace(/\*\*(?=\S)([\s\S]*?\S)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__(?=\S)([\s\S]*?\S)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*\w])\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_\w])_(?=[^\s_])([^_]*?[^\s_])_(?![_\w])/g, '$1<em>$2</em>');
  s = s.replace(/~~(?=\S)([\s\S]*?\S)~~/g, '<del>$1</del>');

  return s.replace(/\u0001(\d+)\u0001/g, (_, k) => `<code>${escapeHtml(codes[Number(k)])}</code>`);
}
