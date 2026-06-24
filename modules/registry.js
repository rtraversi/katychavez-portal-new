// Module registry — the extension contract for the parallel build.
// Adding a Wave-1 module: append one object here + INSERT into supabase modules table.
// run new-module.ps1 <name> to scaffold everything automatically.
//
// IMPORTANT: keep this in sync with migration 002_rbac.sql module seed data.
// The DB is authoritative for access control; this file is authoritative for UI routing.

'use strict';

window.MODULE_REGISTRY = [
  // ── Wave 0 (always present) ────────────────────────────────────────────────
  {
    key:         'client_portal',
    name:        'My Matter',
    icon:        'user',
    route:       'client-portal',
    wave:        0,
    sortOrder:   5,
  },
  {
    key:         'core',
    name:        'Clients & Matters',
    icon:        'users',
    route:       'clients',
    wave:        0,
    sortOrder:   10,
    // page and init are loaded dynamically from pages/<route>/
  },
  {
    key:         'tasks',
    name:        'Tasks',
    icon:        'check-square',
    route:       'tasks',
    wave:        0,
    sortOrder:   20,
  },

  // ── Wave 1 (module branches — not built yet) ───────────────────────────────
  {
    key:         'conflict_checker',
    name:        'Conflict Check',
    icon:        'shield',
    route:       'conflict-checker',
    wave:        1,
    sortOrder:   25,
  },
  {
    key:         'uploads',
    name:        'Document Intake',
    icon:        'upload',
    route:       'uploads',
    wave:        1,
    sortOrder:   30,
  },
  {
    key:         'messaging',
    name:        'Messages',
    icon:        'message-circle',
    route:       'messaging',
    wave:        1,
    sortOrder:   40,
    staffOnly:   true,
    premium:     true,
  },
  {
    key:         'doc_templates',
    name:        'Doc Templates',
    icon:        'file-text',
    route:       'settings/doc-templates',
    wave:        1,
    sortOrder:   85,
    staffOnly:   true,
  },
  {
    key:         'calendar',
    name:        'Calendar',
    icon:        'calendar',
    route:       'calendar',
    wave:        1,
    sortOrder:   45,
    staffOnly:   true,
    premium:     true,
  },
  {
    key:         'billing',
    name:        'Billing & Time',
    icon:        'dollar-sign',
    route:       'billing',
    wave:        1,
    sortOrder:   50,
    premium:     true,
    comingSoon:  true,
  },
  {
    key:         'trust_accounting',
    name:        'Trust Accounting',
    icon:        'briefcase',
    route:       'trust',
    wave:        1,
    sortOrder:   55,
  },
  {
    key:         'ai_brain',
    name:        'AI Assistant',
    icon:        'cpu',
    route:       'ai-brain',
    wave:        1,
    sortOrder:   60,
    premium:     true,
    comingSoon:  true,
  },
  {
    key:         'draft_forms',
    name:        'Document Drafting',
    icon:        'file-text',
    route:       'draft-forms',
    wave:        1,
    sortOrder:   70,
    premium:     true,
    comingSoon:  true,
  },
  {
    key:         'esign',
    name:        'E-Signatures',
    icon:        'pen-tool',
    route:       'esign',
    wave:        1,
    sortOrder:   80,
    premium:     true,
  },
  {
    key:       'sig_stamp',
    name:      'Signature Stamp',
    icon:      'pen-tool',
    route:     'sig-stamp',
    wave:      1,
    sortOrder: 82,
    staffOnly: true,
  },
  {
    key:       'proof_scan',
    name:      'Proof Scan',
    icon:      'shield',
    route:     'proof-scan',
    wave:      1,
    sortOrder: 57,
    staffOnly: true,
    requires:  'immigration',
  },

  // ── Wave 2 ─────────────────────────────────────────────────────────────────
  {
    key:         'dashboard',
    name:        'Dashboard',
    icon:        'bar-chart-2',
    route:       'dashboard',
    wave:        2,
    sortOrder:   1,
    staffOnly:   true,
  },
  {
    key:         'word_embed',
    name:        'Word Integration',
    icon:        'file',
    route:       'word-embed',
    wave:        2,
    sortOrder:   100,
    premium:     true,
    comingSoon:  true,
  },
];
