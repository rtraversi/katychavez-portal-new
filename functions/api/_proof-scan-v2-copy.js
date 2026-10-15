// _proof-scan-v2-copy.js: the server's way into the page's copy. NOT a route.
//
// D-87: Max writes the words. v2.0.2 sentences built on the server (gentle
// confirms, evidence findings, the stage email) take their text from
// pages/proof-scan-v2/copy.js, the same file the page reads, so every one of
// them is a placeholder Max can rewrite in one place. copy.js is plain data
// with no DOM, which is why the server can import it (as the old email does
// with pages/proof-scan/report-model.js).

import { COPY, APPROVED, PORTAL } from '../../pages/proof-scan-v2/copy.js';

// Same lookup and {name} filling as t() in pages/proof-scan-v2/ui.js.
export function copyText(key, vars = {}) {
  const s = PORTAL[key] ?? COPY[key] ?? APPROVED[key];
  if (s == null) return `[${key}]`;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] == null ? '' : String(vars[k])));
}
