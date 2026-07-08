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
    description: 'Access your case documents, updates, and shared communications in one place.',
    badge:       'VIEW MATTER →',
  },
  {
    key:         'core',
    name:        'Clients & Matters',
    icon:        'users',
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
    icon:        'check-square',
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
    icon:        'shield',
    route:       'conflict-checker',
    wave:        1,
    sortOrder:   25,
    description: 'Run instant conflict-of-interest searches before opening new matters.',
    badge:       'RUN CHECK →',
  },
  {
    key:         'uploads',
    name:        'Document Intake',
    icon:        'upload',
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
    icon:        'message-circle',
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
    name:        'Doc Templates',
    icon:        'file-text',
    route:       'settings/doc-templates',
    wave:        1,
    sortOrder:   85,
    staffOnly:   true,
    description: 'Build and manage reusable document templates for the firm.',
    badge:       'VIEW TEMPLATES →',
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
    description: 'Track deadlines, hearings, and court appearances.',
    badge:       'VIEW CALENDAR →',
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
    description: 'Track billable hours, generate invoices, and manage fee arrangements.',
  },
  {
    key:         'trust_accounting',
    name:        'Trust Accounting',
    icon:        'briefcase',
    route:       'trust',
    wave:        1,
    sortOrder:   55,
    description: 'Manage client trust accounts and IOLTA-compliant fund tracking.',
    badge:       'VIEW LEDGER →',
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
    description: 'AI-powered legal research, drafting, and matter summarization.',
  },
  {
    key:         'draft_forms',
    name:        'USCIS Forms',
    icon:        'file-text',
    route:       'draft-forms',
    wave:        1,
    sortOrder:   70,
    premium:     true,
    description: 'Autofill and generate USCIS immigration form packages (DACA, etc.) from client and matter data.',
  },
  {
    key:         'esign',
    name:        'E-Signatures',
    icon:        'pen-tool',
    route:       'esign',
    wave:        1,
    sortOrder:   80,
    premium:     true,
    description: 'Send, track, and collect legally binding signature requests.',
    badge:       'OPEN →',
  },
  {
    key:       'sig_stamp',
    name:      'Signature Stamp',
    icon:      'pen-tool',
    route:     'sig-stamp',
    wave:      1,
    sortOrder: 82,
    staffOnly: true,
    description: 'Apply authenticated signatures to documents.',
    badge:     'STAMP DOCS →',
  },
  {
    key:       'translation',
    name:      'Translation',
    icon:      'globe',
    route:     'translation',
    wave:      1,
    sortOrder: 58,
    staffOnly: true,
    description: 'AI-powered Spanish-to-English certified translation with DOCX & PDF export.',
    badge:     'TRANSLATE →',
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
    description: 'Verify immigration documents and build proof of status packages.',
    badge:     'OPEN →',
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
    description: 'Firm-wide analytics: caseload and staff workload at a glance.',
    badge:       'VIEW →',
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
    description: 'Draft and sync documents directly from Microsoft Word.',
  },
];
