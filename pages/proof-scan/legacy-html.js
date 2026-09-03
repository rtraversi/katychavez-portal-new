// legacy-html.js — renders a pre-Batch-2 `result_html` as inert plain text.
//
// Old Proof Scan rows store HTML that Claude wrote. It has to stay openable, but
// it is untrusted input: model output that quoted an uploaded document, saved
// years ago, never validated against anything.
//
// What this file replaces
// -----------------------
// The page used to run that HTML through themeResultHtml(), which stripped
// `color` and `background` declarations and then assigned the result to
// innerHTML. Removing colours is not a security boundary. It left <script>,
// every on* handler, javascript: and data: URLs, <iframe>, <object>, <form>, and
// arbitrary attributes completely intact.
//
// The boundary here
// -----------------
// The stored bytes are never parsed as HTML. Detached DOM parsing is not used as
// a resource-loading boundary because browser behavior can vary. The whole value
// becomes one Text node, so markup is readable as source but cannot execute,
// navigate, create CSS, or trigger any outbound subresource request.
//
// There is no innerHTML, outerHTML, insertAdjacentHTML, or document.write in this
// file, and no code path that can add one, which is asserted by its unit tests.

export const MAX_LEGACY_TEXT_LENGTH = 500_000;

// The old name is retained at the renderer seam, but its behavior is deliberately
// simpler: createTextNode is the only interpretation step. The length cap avoids
// letting a corrupt row monopolize the page.
export function sanitizeLegacyHtml(raw, { doc = document } = {}) {
  const fragment = doc.createDocumentFragment();
  fragment.appendChild(doc.createTextNode(
    String(raw ?? '').slice(0, MAX_LEGACY_TEXT_LENGTH),
  ));
  return fragment;
}
