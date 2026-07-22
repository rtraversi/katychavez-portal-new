// Module registry — the extension contract for the parallel build.
// Adding a Wave-1 module: append one object here + INSERT into supabase modules table.
// run new-module.ps1 <name> to scaffold everything automatically.
//
// IMPORTANT: keep this in sync with migration 002_rbac.sql module seed data.
// The DB is authoritative for access control; this file is authoritative for UI routing.
//
// `group` assigns each module to a color-coded section (home page) and nav
// group (sidebar). MODULE_GROUPS below is the single source of truth for the
// groups themselves — labels, hue tokens, and display order. `icon` is the
// home-tile icon (flat, colored); `navIcon` is the sidebar icon (monochrome
// stroke). Order within a group follows sortOrder.
//
// badgeFn contract: resolves to a display string; when it starts with
// "<count> <word>" (e.g. "23 ACTIVE →") the leading count is also parsed for
// the home-tile pill and the sidebar nav count. Keep that shape for live counts.

'use strict';

// Group key → section metadata. `hue` names the CSS accent token pair
// (--<hue> / --<hue>-tint in css/variables.css). Object order = display order.
// `matter` is the client-facing view; staff pages skip it.
window.MODULE_GROUPS = {
  daily:   { label: 'Daily Work',           hue: 'daily'   },
  intake:  { label: 'Intake & Screening',   hue: 'intake'  },
  docs:    { label: 'Documents & Drafting', hue: 'docs'    },
  money:   { label: 'Finance',              hue: 'money'   },
  horizon: { label: 'On the Horizon',       hue: 'horizon' },
  matter:  { label: 'Your Matter',          hue: 'daily'   },
};

window.MODULE_REGISTRY = [
  // ── Wave 0 (always present) ────────────────────────────────────────────────
  {
    key:         'client_portal',
    name:        'My Matter',
    group:       'matter',
    icon:        'user',
    navIcon:     'user',
    route:       'client-portal',
    wave:        0,
    sortOrder:   5,
    description: 'Access your case documents, updates, and shared communications in one place.',
    badge:       'VIEW MATTER →',
  },
  {
    key:         'case_intake',
    name:        'Case Intake',
    group:       'intake',
    icon:        'tile-case-intake',
    navIcon:     'check-square',
    route:       'case-intake',
    wave:        0,
    sortOrder:   6,
    description: 'Fill in the details of your case — opposing party, marriage, children, and finances.',
    badge:       'START →',
  },
  {
    key:         'core',
    name:        'Clients & Matters',
    group:       'daily',
    icon:        'tile-clients',
    navIcon:     'users',
    route:       'clients',
    wave:        0,
    sortOrder:   10,
    description: 'Manage client records, open matters, and case files across the firm.',
    badge:       'VIEW →',
    badgeFn:     async db => {
      const { count } = await db.from('matters').select('*', { count: 'exact', head: true }).in('status', ['intake', 'active']);
      return count ? `${count} ACTIVE →` : 'VIEW →';
    },
  },
  {
    key:         'tasks',
    name:        'Tasks',
    group:       'daily',
    icon:        'tile-tasks',
    navIcon:     'check-square',
    route:       'tasks',
    wave:        0,
    sortOrder:   20,
    description: 'Track deadlines, assignments, and to-dos across all open matters.',
    badge:       'VIEW →',
    badgeFn:     async db => {
      const { count } = await db.from('tasks').select('*', { count: 'exact', head: true }).neq('status', 'completed').neq('status', 'cancelled');
      return count ? `${count} OPEN →` : 'VIEW →';
    },
  },

  // ── Wave 1 (module branches) ───────────────────────────────────────────────
  {
    key:         'conflict_checker',
    name:        'Conflict Check',
    group:       'intake',
    icon:        'tile-conflict',
    navIcon:     'shield',
    route:       'conflict-checker',
    wave:        1,
    sortOrder:   25,
    description: 'Run instant conflict-of-interest searches before opening new matters.',
    badge:       'RUN CHECK →',
  },
  {
    key:         'uploads',
    name:        'Document Intake',
    group:       'intake',
    icon:        'tile-uploads',
    navIcon:     'upload',
    route:       'uploads',
    wave:        1,
    sortOrder:   30,
    description: 'Collect and organize client-submitted documents and evidence files.',
    badge:       'VIEW →',
    badgeFn:     async db => {
      const { count } = await db.from('documents').select('*', { count: 'exact', head: true }).eq('status', 'pending');
      return count ? `${count} PENDING →` : 'VIEW →';
    },
  },
  {
    key:         'messaging',
    name:        'Messages',
    group:       'daily',
    icon:        'tile-messages',
    navIcon:     'message-circle',
    route:       'messaging',
    wave:        1,
    sortOrder:   40,
    staffOnly:   true,
    premium:     true,
    description: 'Encrypted messaging for internal staff and client communications.',
    badge:       'OPEN →',
    badgeFn:     async db => {
      const { count } = await db.from('messages').select('*', { count: 'exact', head: true }).eq('direction', 'inbound').is('read_at', null);
      return count ? `${count} UNREAD →` : 'OPEN →';
    },
  },
  {
    key:         'doc_templates',
    name:        'Client Document Checklist',
    group:       'docs',
    icon:        'tile-doc-templates',
    navIcon:     'file-text',
    route:       'settings/doc-templates',
    wave:        1,
    sortOrder:   71,
    staffOnly:   true,
    description: 'Required-document checklists applied to matters at intake (Apply Checklist).',
    badge:       'VIEW TEMPLATES →',
  },
  {
    key:         'doc_drafting',
    name:        'Word Templates',
    group:       'docs',
    icon:        'tile-word-templates',
    navIcon:     'file-text',
    route:       'settings/word-templates',
    wave:        1,
    sortOrder:   72,
    staffOnly:   true,
    description: 'Reusable Word (.docx) templates for drafting and the "New from Template" action.',
    badge:       'MANAGE →',
  },
  {
    key:         'calendar',
    name:        'Calendar',
    group:       'daily',
    icon:        'tile-calendar',
    navIcon:     'calendar',
    route:       'calendar',
    wave:        1,
    sortOrder:   35,
    staffOnly:   true,
    premium:     true,
    description: 'Track deadlines, hearings, and court appearances.',
    badge:       'VIEW CALENDAR →',
  },
  {
    key:         'scheduling',
    name:        'Appointments',
    group:       'intake',
    icon:        'tile-calendar',
    navIcon:     'calendar',
    route:       'scheduling',
    wave:        1,
    sortOrder:   36,
    staffOnly:   true,
    premium:     true,
    requires:    'calendar',
    description: 'Online consult booking — prospects see real availability and book from your website.',
    badge:       'APPOINTMENTS →',
    badgeFn:     async db => {
      const { count } = await db.from('appointments').select('*', { count: 'exact', head: true })
        .eq('status', 'booked').gte('starts_at', new Date().toISOString());
      return count ? `${count} UPCOMING →` : 'APPOINTMENTS →';
    },
  },
  {
    key:         'billing',
    name:        'Billing & Invoicing',
    group:       'money',
    icon:        'money-flat',
    navIcon:     'dollar-sign',
    route:       'billing',
    wave:        1,
    sortOrder:   50,
    staffOnly:   true,
    premium:     true,
    description: 'Create invoices from time entries, send to clients, and track payments.',
    badge:       'VIEW →',
    badgeFn:     async db => {
      const { count } = await db.from('invoices').select('*', { count: 'exact', head: true }).eq('status', 'draft');
      return count ? `${count} DRAFT →` : 'VIEW →';
    },
  },
  {
    key:         'trust_accounting',
    name:        'Trust Accounting',
    group:       'money',
    icon:        'bank-flat',
    navIcon:     'briefcase',
    route:       'trust',
    wave:        1,
    sortOrder:   55,
    description: 'Manage client trust accounts and IOLTA-compliant fund tracking.',
    badge:       'VIEW LEDGER →',
  },
  {
    key:         'ai_brain',
    name:        'AI Assistant',
    group:       'horizon',
    icon:        'tile-ai',
    navIcon:     'cpu',
    route:       'ai-brain',
    wave:        1,
    sortOrder:   60,
    premium:     true,
    comingSoon:  true,
    description: 'AI-powered legal research, drafting, and matter summarization.',
  },
  {
    key:         'draft_forms',
    name:        'USCIS Forms',
    group:       'docs',
    icon:        'tile-draft-forms',
    navIcon:     'file-text',
    route:       'draft-forms',
    wave:        1,
    sortOrder:   79,
    premium:     true,
    description: 'Autofill and generate USCIS immigration form packages (DACA, etc.) from client and matter data.',
  },
  {
    key:         'esign',
    name:        'E-Signatures',
    group:       'docs',
    icon:        'tile-esign',
    navIcon:     'pen-tool',
    route:       'esign',
    wave:        1,
    sortOrder:   74,
    premium:     true,
    description: 'Send, track, and collect legally binding signature requests.',
    badge:       'OPEN →',
  },
  {
    key:       'sig_stamp',
    name:      'Signature Stamp',
    group:     'docs',
    icon:      'record-flat',
    navIcon:   'pen-tool',
    route:     'sig-stamp',
    wave:      1,
    sortOrder: 76,
    staffOnly: true,
    description: 'Apply authenticated signatures to documents.',
    badge:     'STAMP DOCS →',
  },
  {
    key:       'translation',
    name:      'Translation',
    group:     'docs',
    icon:      'tile-translation',
    navIcon:   'globe',
    route:     'translation',
    wave:      1,
    sortOrder: 78,
    staffOnly: true,
    premium:   true,
    description: 'AI-powered document translation to English with optional certification — DOCX & PDF export.',
    badge:     'TRANSLATE →',
  },
  {
    key:       'proof_scan',
    name:      'Proof Scan',
    group:     'intake',
    icon:      'tile-proof-scan',
    navIcon:   'shield',
    route:     'proof-scan',
    wave:      1,
    sortOrder: 57,
    staffOnly: true,
    requires:  'immigration',
    description: 'Verify immigration documents and build proof of status packages.',
    badge:     'OPEN →',
  },

  // ── Wave 2 ─────────────────────────────────────────────────────────────────
  {
    key:         'dashboard',
    name:        'Dashboard',
    group:       'daily',
    icon:        'tile-dashboard',
    navIcon:     'bar-chart-2',
    route:       'dashboard',
    wave:        2,
    sortOrder:   1,
    staffOnly:   true,
    description: 'Firm-wide analytics: caseload and staff workload at a glance.',
    badge:       'VIEW →',
  },
  {
    key:         'word_embed',
    name:        'Word Integration',
    group:       'horizon',
    icon:        'tile-word-embed',
    navIcon:     'file',
    route:       'word-embed',
    wave:        2,
    sortOrder:   100,
    premium:     true,
    comingSoon:  true,
    description: 'Draft and sync documents directly from Microsoft Word.',
  },
];
