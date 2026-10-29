// Ask Claude page helpers: the Markdown renderer (the only path from a model
// reply to the DOM, so escaping is the point) and the transcript view.
import { describe, it, expect } from 'vitest';
import { renderMarkdown, citeToken } from '../../pages/ai-chat/markdown.js';
import { assistantView, plainAnswer, userView, fmtBytes, createNdjsonReader } from '../../pages/ai-chat/transcript.js';

describe('renderMarkdown: safety', () => {
  it('escapes raw HTML everywhere', () => {
    const html = renderMarkdown('<script>alert(1)</script>\n\n- <img src=x onerror=alert(1)>\n\n| a |\n|---|\n| <b>x</b> |\n\n`<i>`');
    expect(html).not.toMatch(/<script|<img|<b>|<i>/);
    expect(html).toContain('&lt;script&gt;');
  });

  it('keeps only http(s) and mailto links', () => {
    expect(renderMarkdown('[ok](https://www.uscis.gov/i-212)')).toContain('<a href="https://www.uscis.gov/i-212" target="_blank" rel="noopener noreferrer">ok</a>');
    const bad = renderMarkdown('[bad](javascript:alert(1)) [data](data:text/html,x)');
    expect(bad).not.toContain('<a');
  });

  it('cannot break out of an href with quotes', () => {
    const html = renderMarkdown('[x](https://a.test/"onmouseover="alert(1))');
    expect(html).not.toMatch(/"onmouseover="/);
  });

  it('links bare URLs without double-linking markdown links', () => {
    const html = renderMarkdown('See https://www.uscis.gov/policy-manual. And [PM](https://www.uscis.gov/pm).');
    expect(html.match(/<a /g)).toHaveLength(2);
    expect(html).toContain('>https://www.uscis.gov/policy-manual</a>.');
  });
});

describe('renderMarkdown: formatting', () => {
  it('renders headings one level under the page, with inline marks', () => {
    expect(renderMarkdown('# Evidence\n## Core documents\n### Detail')).toBe('<h3>Evidence</h3><h4>Core documents</h4><h5>Detail</h5>');
    expect(renderMarkdown('**INA 212(a)(9)(C)** and *Matter of Briones* and `I-212`'))
      .toBe('<p><strong>INA 212(a)(9)(C)</strong> and <em>Matter of Briones</em> and <code>I-212</code></p>');
  });

  it('nests lists and keeps ordered starts', () => {
    const html = renderMarkdown('1. Proof of departure\n   - Passport stamps\n   - Foreign records\n2. Ten years outside\n\n3. Hardship');
    expect(html).toBe('<ol><li>Proof of departure<ul><li>Passport stamps</li><li>Foreign records</li></ul></li><li>Ten years outside</li><li>Hardship</li></ol>');
    expect(renderMarkdown('3. Third\n4. Fourth')).toBe('<ol start="3"><li>Third</li><li>Fourth</li></ol>');
  });

  it('joins single newlines with <br> and splits paragraphs on blank lines', () => {
    expect(renderMarkdown('Line one\nLine two\n\nNext')).toBe('<p>Line one<br>Line two</p><p>Next</p>');
  });

  it('renders tables, quotes, rules and code fences', () => {
    expect(renderMarkdown('| Bar | Cite |\n|:---|---:|\n| 9(C) | INA 212(a)(9)(C) |'))
      .toBe('<div class="ac-table-wrap"><table><thead><tr><th>Bar</th><th style="text-align:right">Cite</th></tr></thead><tbody><tr><td>9(C)</td><td style="text-align:right">INA 212(a)(9)(C)</td></tr></tbody></table></div>');
    expect(renderMarkdown('> quoted **text**')).toBe('<blockquote><p>quoted <strong>text</strong></p></blockquote>');
    expect(renderMarkdown('a\n\n---\n\nb')).toBe('<p>a</p><hr><p>b</p>');
    expect(renderMarkdown('```\n<b>&\n```')).toBe('<pre><code>&lt;b&gt;&amp;</code></pre>');
  });

  it('does not italicize underscores inside words or identifiers', () => {
    expect(renderMarkdown('file_name_here and 8_CFR_212')).toBe('<p>file_name_here and 8_CFR_212</p>');
  });

  it('swaps citation tokens for caller HTML, or drops them', () => {
    const src = `The bar is permanent.${citeToken(1)}`;
    expect(renderMarkdown(src, { cite: (n) => `<sup>${n}</sup>` })).toBe('<p>The bar is permanent.<sup>1</sup></p>');
    expect(renderMarkdown(src)).toBe('<p>The bar is permanent.</p>');
  });
});

describe('assistantView', () => {
  const c1 = { url: 'https://www.uscis.gov/a', title: 'USCIS A' };
  const c2 = { url: 'https://www.ecfr.gov/b', title: 'eCFR B' };
  const content = [
    { type: 'thinking', thinking: 'Summary of reasoning', signature: 's' },
    { type: 'server_tool_use', name: 'web_search', input: { query: 'I-212 Policy Manual' } },
    { type: 'web_search_tool_result', content: [] },
    { type: 'text', text: 'First point.', citations: [c1, c2] },
    { type: 'text', text: ' Second point.\n', citations: [c1] },
    { type: 'text', text: 'No cite.' },
  ];

  it('numbers sources once each and marks cited text', () => {
    const v = assistantView(content);
    expect(v.sources).toEqual([{ n: 1, url: c1.url, title: 'USCIS A' }, { n: 2, url: c2.url, title: 'eCFR B' }]);
    expect(v.text).toBe(`First point.${citeToken(1)}${citeToken(2)} Second point.${citeToken(1)}\nNo cite.`);
    expect(v.thinking).toBe('Summary of reasoning');
    expect(v.searches).toEqual(['I-212 Policy Manual']);
  });

  it('copies as plain text with a sources list', () => {
    expect(plainAnswer(content)).toBe('First point. Second point.\nNo cite.\n\nSources:\n1. USCIS A – https://www.uscis.gov/a\n2. eCFR B – https://www.ecfr.gov/b');
  });

  it('reads a user turn', () => {
    expect(userView([{ type: 'attachment', attachment_id: 'a' }, { type: 'text', text: 'Q' }])).toEqual({ text: 'Q', attachmentIds: ['a'] });
  });
});

describe('small helpers', () => {
  it('formats sizes', () => {
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(1536)).toBe('1.5 KB');
    expect(fmtBytes(15 * 1024 * 1024)).toBe('15 MB');
  });

  it('reads ndjson across chunk boundaries', () => {
    const got = [];
    const r = createNdjsonReader((e) => got.push(e));
    r.push('{"type":"te');
    r.push('xt","text":"a"}\n{"type":"done"}');
    r.end();
    expect(got).toEqual([{ type: 'text', text: 'a' }, { type: 'done' }]);
  });
});
