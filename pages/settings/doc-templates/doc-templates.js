'use strict';

(async function DocTemplatesPage() {

  let templates    = [];
  let activeFilter = 'all';
  let canWrite     = false;

  const tbody = document.getElementById('templates-tbody');
  const modal = document.getElementById('dt-modal');

  const CASE_TYPE_LABELS = {
    '':                       'Universal (all)',
    divorce:                  'Divorce',
    sapcr_original:           'SAPCR Original',
    sapcr_modification:       'SAPCR Modification',
    custody:                  'Custody',
    custody_modification:     'Custody Modification',
    child_support:            'Child Support',
    child_support_modification:'Child Support Modification',
    paternity:                'Paternity',
    prenuptial_agreement:     'Prenuptial Agreement',
    postnuptial_agreement:    'Postnuptial Agreement',
    enforcement:              'Enforcement',
    protective_order:         'Protective Order',
    adoption:                 'Adoption',
    guardianship:             'Guardianship',
    other:                    'Other',
  };

  const CATEGORY_LABELS = {
    pleading:       'Pleading',
    agreement:      'Agreement',
    correspondence: 'Correspondence',
    financial:      'Financial',
    id:             'ID / Identity',
    court_order:    'Court Order',
    other:          'Other',
  };

  // ── Auth ─────────────────────────────────────────────────────────────────────

  const profile  = await Auth.getProfile();
  const roleName = profile?.role?.name || '';
  canWrite = ['Owner', 'Attorney', 'Partner Attorney'].includes(roleName);
  document.getElementById('btn-add-template').style.display = canWrite ? '' : 'none';

  // ── Load ──────────────────────────────────────────────────────────────────────

  async function load() {
    const session = await Auth.getSession();
    const res     = await fetch('/api/get-doc-templates', {
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    });
    const data = await res.json();
    if (!res.ok) { Utils.toast(data.error || 'Failed to load templates.', 'error'); return; }
    templates = data.templates || [];
    render();
  }

  // ── Helpers ───────────────────────────────────────────────────────────────────

  const CASE_TYPE_ENTRIES = Object.entries(CASE_TYPE_LABELS).filter(([v]) => v !== '');

  function formatCaseTypes(caseTypes) {
    if (!caseTypes || caseTypes.length === 0) return 'Universal (all)';
    const labels = caseTypes.map(ct => CASE_TYPE_LABELS[ct] || ct);
    if (labels.length <= 2) return labels.join(', ');
    return `${labels.slice(0, 2).join(', ')} +${labels.length - 2} more`;
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  function render() {
    const filtered = activeFilter === 'all'
      ? templates
      : activeFilter === ''
        ? templates.filter(t => !t.case_types || t.case_types.length === 0)
        : templates.filter(t => Array.isArray(t.case_types) && t.case_types.includes(activeFilter));

    if (!filtered.length) {
      tbody.innerHTML = `<tr><td colspan="5" style="padding:var(--space-10);text-align:center;color:var(--color-text-muted)">No templates found.</td></tr>`;
      return;
    }

    tbody.innerHTML = filtered.map(t => `
      <tr data-id="${t.id}">
        <td style="font-weight:500">${Utils.esc(t.doc_name)}</td>
        <td>${Utils.esc(formatCaseTypes(t.case_types))}</td>
        <td>${Utils.esc(CATEGORY_LABELS[t.doc_category] || t.doc_category || '—')}</td>
        <td>
          <span class="badge badge--${t.is_required_by_default ? 'active' : 'normal'}">
            ${t.is_required_by_default ? 'Required' : 'Optional'}
          </span>
        </td>
        <td>
          ${canWrite ? `
            <div style="display:flex;gap:var(--space-2)">
              <button class="btn btn--ghost btn--sm dt-edit-btn" data-id="${t.id}" title="Edit">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn btn--ghost btn--sm dt-delete-btn" data-id="${t.id}" title="Delete" style="color:var(--color-danger)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </button>
            </div>` : ''}
        </td>
      </tr>`).join('');
  }

  // ── Modal ─────────────────────────────────────────────────────────────────────

  function openModal(template = null) {
    const isEdit      = !!template;
    const isUniversal = !template?.case_types || template.case_types.length === 0;
    const selectedTypes = template?.case_types || [];

    const catOpts = Object.entries(CATEGORY_LABELS)
      .map(([v, l]) => `<option value="${v}"${template?.doc_category === v ? ' selected' : ''}>${Utils.esc(l)}</option>`).join('');

    const ctCheckboxes = CASE_TYPE_ENTRIES.map(([v, l]) => `
      <label style="display:flex;align-items:center;gap:var(--space-2);cursor:pointer;font-weight:400;font-size:var(--text-sm)">
        <input type="checkbox" class="dt-ct-cb" value="${v}" style="width:auto;flex-shrink:0" ${selectedTypes.includes(v) ? 'checked' : ''}>
        ${Utils.esc(l)}
      </label>`).join('');

    modal.innerHTML = `
      <div class="modal" style="max-width:540px">
        <div class="modal-header">
          <h2 class="modal-title">${isEdit ? 'Edit' : 'Add'} template item</h2>
          <button class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body">
          <div class="field">
            <label>Document name <span class="required">*</span></label>
            <input type="text" id="dt-doc-name" value="${Utils.esc(template?.doc_name || '')}" placeholder="e.g. Financial Affidavit" autocomplete="off">
          </div>
          <div class="field">
            <label>Applies to</label>
            <label style="display:flex;align-items:center;gap:var(--space-3);font-weight:400;cursor:pointer;margin-bottom:var(--space-3)">
              <input type="checkbox" id="dt-universal" style="width:auto" ${isUniversal ? 'checked' : ''}>
              <span style="font-weight:500">Universal — applies to all case types</span>
            </label>
            <div id="dt-ct-grid" style="display:${isUniversal ? 'none' : 'grid'};grid-template-columns:1fr 1fr;gap:var(--space-2) var(--space-6);padding:var(--space-3);background:var(--color-bg-subtle);border-radius:var(--radius);border:1px solid var(--color-border)">
              ${ctCheckboxes}
            </div>
            <div id="dt-ct-err" class="form-error hidden" style="margin-top:var(--space-2)">Select at least one case type, or mark as Universal.</div>
          </div>
          <div class="field">
            <label>Category</label>
            <select id="dt-category">${catOpts}</select>
          </div>
          <div class="field">
            <label>Description <span style="color:var(--color-text-muted);font-weight:400">(optional)</span></label>
            <input type="text" id="dt-description" value="${Utils.esc(template?.description || '')}" placeholder="Short guidance for staff or client">
          </div>
          <div class="field" style="margin:0">
            <label style="display:flex;align-items:center;gap:var(--space-3);font-weight:400;cursor:pointer">
              <input type="checkbox" id="dt-required" style="width:auto" ${template?.is_required_by_default !== false ? 'checked' : ''}>
              Required by default
            </label>
          </div>
          <div id="dt-error" class="form-error hidden" style="margin-top:var(--space-3)"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn--secondary" id="dt-cancel">Cancel</button>
          <button class="btn btn--primary" id="dt-save">${isEdit ? 'Save changes' : 'Add item'}</button>
        </div>
      </div>`;

    modal.classList.remove('hidden');
    document.getElementById('dt-doc-name').focus();

    modal.querySelector('.modal-close').addEventListener('click', closeModal);
    document.getElementById('dt-cancel').addEventListener('click', closeModal);
    modal.addEventListener('click', e => { if (e.target === modal) closeModal(); });

    document.getElementById('dt-universal').addEventListener('change', e => {
      document.getElementById('dt-ct-grid').style.display = e.target.checked ? 'none' : 'grid';
      document.getElementById('dt-ct-err').classList.add('hidden');
    });

    document.getElementById('dt-save').addEventListener('click', async () => {
      const nameEl  = document.getElementById('dt-doc-name');
      const errEl   = document.getElementById('dt-error');
      const ctErr   = document.getElementById('dt-ct-err');
      const saveBtn = document.getElementById('dt-save');
      const name    = nameEl.value.trim();

      errEl.classList.add('hidden');
      ctErr.classList.add('hidden');
      if (!name) { errEl.textContent = 'Document name is required.'; errEl.classList.remove('hidden'); return; }

      const universal  = document.getElementById('dt-universal').checked;
      const caseTypes  = universal
        ? null
        : [...modal.querySelectorAll('.dt-ct-cb:checked')].map(cb => cb.value);

      if (!universal && caseTypes.length === 0) {
        ctErr.classList.remove('hidden');
        return;
      }

      Utils.setLoading(saveBtn, true);

      const payload = {
        action:                 isEdit ? 'update' : 'create',
        doc_name:               name,
        case_types:             caseTypes,
        doc_category:           document.getElementById('dt-category').value,
        description:            document.getElementById('dt-description').value.trim() || null,
        is_required_by_default: document.getElementById('dt-required').checked,
      };
      if (isEdit) payload.id = template.id;

      const session = await Auth.getSession();
      const res = await fetch('/api/save-doc-template', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify(payload),
      });
      const data = await res.json();

      if (!res.ok) {
        errEl.textContent = data.error || 'Save failed.';
        errEl.classList.remove('hidden');
        Utils.setLoading(saveBtn, false);
        return;
      }

      closeModal();
      Utils.toast(isEdit ? 'Template updated.' : 'Template item added.', 'success');
      await load();
    });
  }

  function closeModal() {
    modal.classList.add('hidden');
    modal.innerHTML = '';
  }

  // ── Delete ────────────────────────────────────────────────────────────────────

  async function deleteTemplate(id) {
    const item = templates.find(t => t.id === id);
    if (!await Utils.confirm(`Delete "${item?.doc_name}"? This won't remove it from existing matters — only from future checklist applications.`, { confirmLabel: 'Delete', danger: true })) return;

    const session = await Auth.getSession();
    const res = await fetch('/api/save-doc-template', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body: JSON.stringify({ action: 'delete', id }),
    });
    const data = await res.json();
    if (!res.ok) { Utils.toast(data.error || 'Delete failed.', 'error'); return; }
    Utils.toast('Template item deleted.', 'success');
    await load();
  }

  // ── Event wiring ──────────────────────────────────────────────────────────────

  document.getElementById('btn-add-template').addEventListener('click', () => openModal());

  document.querySelectorAll('.dt-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.dt-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilter = btn.dataset.filter === undefined ? 'all' : btn.dataset.filter;
      render();
    });
  });

  tbody.addEventListener('click', e => {
    const editBtn   = e.target.closest('.dt-edit-btn');
    const deleteBtn = e.target.closest('.dt-delete-btn');
    if (editBtn)   { const t = templates.find(t => t.id === editBtn.dataset.id);   if (t) openModal(t); }
    if (deleteBtn) { deleteTemplate(deleteBtn.dataset.id); }
  });

  // ── Init ──────────────────────────────────────────────────────────────────────
  await load();

})();
