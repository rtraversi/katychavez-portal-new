'use strict';

/* ────────────────────────────────────────────────────────────────────────────
   Help guide manifest.
   Each entry describes a guide shown in the shared Help slide-over
   (js/help-drawer.js). The document BODY itself lives as its own file in the
   repo under /help/guides/ — this file only holds metadata + a pointer, so the
   prose is edited as a document, versioned with the code, and the repo is the
   single source of truth (any Google Doc drafts are origin material, not canon).

   Fields:
     id       unique slug (used by HelpDrawer.open('<id>') and masthead buttons)
     kicker   small eyebrow label
     title    guide title
     subtitle one-line description
     updated  freshness line shown under the title / on the index card
     summary  card blurb on the guide index
     src      URL the drawer fetches the HTML body from. A repo path
              (/help/guides/x.html) for staff docs, OR an absolute URL for
              content served elsewhere — e.g. the planned public resources R2
              bucket for client-facing "helpful hints"/library material. Same
              renderer either way.
     html     (optional) inline HTML body; if present, used instead of `src`.

   To add a guide: drop its HTML fragment in /help/guides/, then push an entry
   here. To surface it contextually, add a .dk-help-btn on the relevant page
   pointing at its id.
   ──────────────────────────────────────────────────────────────────────────── */

window.HELP_GUIDES = window.HELP_GUIDES || [];

window.HELP_GUIDES.push({
  id:       'billing-trust',
  kicker:   'Finance · How it works',
  title:    'Billing, Invoicing & Trust Accounting',
  subtitle: 'A plain-language guide to how money moves through the portal.',
  updated:  'Updated July 2026',
  summary:  'The trust-first model, the FreshBooks-first invoicing loop (compose in FB, send from the portal), the two ways an invoice gets paid, and the IOLTA guardrails built into the system.',
  src:      '/help/guides/billing-trust.html',
});
