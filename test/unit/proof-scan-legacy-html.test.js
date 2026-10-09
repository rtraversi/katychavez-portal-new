// Adversarial tests for the legacy Proof Scan boundary (Batch 4).
// Stored legacy HTML is displayed as one bounded text node. It is never parsed.
import { describe, it, expect } from 'vitest';
import {
  sanitizeLegacyHtml,
  MAX_LEGACY_TEXT_LENGTH,
} from '../../pages/proof-scan/legacy-html.js';

function fakeDoc() {
  return {
    createTextNode: (data) => ({ nodeType: 3, data }),
    createDocumentFragment: () => ({
      nodeType: 11,
      childNodes: [],
      appendChild(node) { this.childNodes.push(node); return node; },
    }),
  };
}

const HOSTILE = [
  '<img src="https://evil.example/image">',
  '<iframe src="https://evil.example/frame"></iframe>',
  '<link rel="stylesheet" href="https://evil.example/x.css">',
  '<object data="https://evil.example/object"></object>',
  '<svg><image href="https://evil.example/svg"></image></svg>',
  '<style>body{background:url(https://evil.example/css)}</style>',
  '<p onclick="fetch(\'https://evil.example/event\')">event</p>',
  '<a href="javascript:alert(1)">javascript</a>',
  '<a href="data:text/html,<script>alert(1)</script>">data</a>',
  '<div><p malformed="nested><img src=//evil.example/nested>text',
].join('\n');

describe('legacy HTML plain-text boundary', () => {
  it('turns every hostile construct into one inert text node', () => {
    const fragment = sanitizeLegacyHtml(HOSTILE, { doc: fakeDoc() });
    expect(fragment.childNodes).toHaveLength(1);
    expect(fragment.childNodes[0]).toEqual({ nodeType: 3, data: HOSTILE });
  });

  it('never invokes a parser or creates an element', () => {
    const doc = fakeDoc();
    doc.createElement = () => { throw new Error('must not create elements'); };
    const fragment = sanitizeLegacyHtml('<img src="https://evil.example">', { doc });
    expect(fragment.childNodes[0].data).toContain('<img');
  });

  it('coerces empty and non-string results without interpreting them', () => {
    expect(sanitizeLegacyHtml(null, { doc: fakeDoc() }).childNodes[0].data).toBe('');
    expect(sanitizeLegacyHtml(42, { doc: fakeDoc() }).childNodes[0].data).toBe('42');
  });

  it('bounds corrupt legacy values', () => {
    const fragment = sanitizeLegacyHtml('x'.repeat(MAX_LEGACY_TEXT_LENGTH + 10), { doc: fakeDoc() });
    expect(fragment.childNodes[0].data).toHaveLength(MAX_LEGACY_TEXT_LENGTH);
  });
});

const pageSources = import.meta.glob('../../pages/proof-scan/*.js', {
  query: '?raw', import: 'default', eager: true,
});
const codeOf = (name) => pageSources[`../../pages/proof-scan/${name}`]
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n').map((line) => line.replace(/(^|\s)\/\/.*$/, '')).join('\n');

describe('legacy HTML source', () => {
  it('contains no HTML parser, insertion sink, or resource-bearing element creation', () => {
    expect(codeOf('legacy-html.js')).not.toMatch(
      /DOMParser|parseFromString|innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|createElement/,
    );
  });

  it('is the only route legacy HTML has into the page', () => {
    const controller = codeOf('proof-scan.js');
    expect(controller).toMatch(/sanitizeLegacyHtml/);
    expect(controller).not.toMatch(/themeResultHtml|innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(codeOf('report.js')).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
  });
});
