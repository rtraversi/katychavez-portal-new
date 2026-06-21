'use strict';

(async function DocTemplatesPage() {

  let templates          = [];
  let library            = [];
  let practiceAreas      = [];
  let caseTypesData      = [];
  let caseTypeKeyMap     = new Map();  // key → name
  let importedLibraryIds = new Set();
  let enabledPaKeys      = new Set();
  let activePa           = 'all';     // 'all' | '__universal__' | practice_area id
  let activeCt           = null;      // null | case_type key
  let canWrite           = false;

  const tbody     = document.getElementById('templates-tbody');
  const modal     = document.getElementById('dt-modal');
  const libModal  = document.getElementById('lib-modal');
  const filterBar = document.getElementById('dt-filter-bar');

  const CATEGORY_LABELS = {
    pleading:       'Pleading',
    agreement:      'Agreement',
    correspondence: 'Correspondence',
    financial:      'Financial',
    id:             'ID / Identity',
    court_order:    'Court Order',
    other:          'Other',
  };

  const TAB_BASE  = 'padding:var(--space-2) var(--space-4);font-size:var(--text-sm);font-weight:500;background:none;border:none;border-bottom:2px solid transparent;cursor:pointer;color:var(--color-text-muted);transition:color .15s,border-color .15s;white-space:nowrap';
  const TAB_ACTV  = 'padding:var(--space-2) var(--space-4);font-size:var(--text-sm);font-weight:600;background:none;border:none;border-bottom:2px solid var(--color-primary);cursor:pointer;color:var(--color-primary);white-space:nowrap';
  const CHIP_BASE = 'padding:var(--space-1) var(--space-3);font-size:var(--text-xs);font-weight:500;background:var(--color-bg-subtle);border:1px solid var(--color-border);border-radius:999px;cursor:pointer;color:var(--color-text-muted);white-space:nowrap;transition:background .15s,color .15s,border-color .15s';
  const CHIP_ACTV = 'padding:var(--space-1) var(--space-3);font-size:var(--text-xs);font-weight:600;background:var(--color-primary);border:1px solid var(--color-primary);border-radius:999px;cursor:pointer;color:#fff;white-space:nowrap';

  // ── Auth ─────────────────────────────────────────────────────────────────────

  const profile  = await Auth.getProfile();
  const roleName = profile?.role?.name || '';
  canWrite = ['Owner', 'Attorney', 'Partner Attorney'].includes(roleName);
  document.getElementById('btn-add-template').style.display   = canWrite ? '' : 'none';
  document.getElementById('btn-add-recommended').style.display = canWrite ? '' : 'none';
  document.getElementById('btn-browse-library').style.display  = canWrite ? '' : 'none';

  // ── Load reference data ───────────────────────────────────────────────────────

  async function loadReferenceData() {
    const [{ data: pa }, { data: ct }, { data: enabledPa }] = await Promise.all([
      db.from('practice_areas').select('*').order('sort_order'),
      db.from('case_types').select('*').order('sort_order'),
      db.from('enabled_practice_areas').select('practice_area_key'),
    ]);
    enabledPaKeys  = new Set((enabledPa || []).map(r => r.practice_area_key));
    practiceAreas  = (pa || []).filter(p => enabledPaKeys.has(p.key));
    caseTypesData  = ct || [];
    caseTypeKeyMap = new Map(caseTypesData.map(c => [c.key, c.name]));
    renderFilters();
  }

  // ── Load library ──────────────────────────────────────────────────────────────

  async function loadLibrary() {
    const { data } = await db.from('doc_template_library').select('*').order('sort_order');
    library = data || [];
  }

  // ── Load firm's adopted templates ─────────────────────────────────────────────

  async function load() {
    const session = await Auth.getSession();
    const res     = await fetch('/api/get-doc-templates', {
      headers: { 'Authorization': `Bearer ${session.access_token}` },
    });
    const data = await res.json();
    if (!res.ok) { Utils.toast(data.error || 'Failed to load templates.', 'error'); return; }
    templates          = data.templates || [];
    importedLibraryIds = new Set(templates.map(t => t.library_id).filter(Boolean));
    render();
  }

  // ── Two-level filter: PA tabs + case type chips ───────────────────────────────

  function renderFilters() {
    let tabsHtml = `<div style="display:flex;gap:0;border-bottom:1px solid var(--color-border);margin-bottom:var(--space-3)">`;
    tabsHtml += `<button class="dt-pa-tab" data-pa="all" style="${activePa === 'all' ? TAB_ACTV : TAB_BASE}">All</button>`;
    tabsHtml += `<button class="dt-pa-tab" data-pa="__universal__" style="${activePa === '__universal__' ? TAB_ACTV : TAB_BASE}">Universal</button>`;
    practiceAreas.forEach(pa => {
      if (!caseTypesData.some(ct => ct.practice_area_id === pa.id)) return;
      tabsHtml += `<button class="dt-pa-tab" data-pa="${Utils.esc(pa.id)}" style="${activePa === pa.id ? TAB_ACTV : TAB_BASE}">${Utils.esc(pa.name)}</button>`;
    });
    tabsHtml += `</div>`;

    let chipsHtml = '';
    if (activePa !== 'all' && activePa !== '__universal__') {
      const pa    = practiceAreas.find(p => p.id === activePa);
      const paCts = caseTypesData.filter(ct => ct.practice_area_id === activePa);
      chipsHtml = `<div style="display:flex;gap:var(--space-2);flex-wrap:wrap;padding-bottom:var(--space-1)">`;
      chipsHtml += `<button class="dt-ct-chip" data-ct="" style="${activeCt === null ? CHIP_ACTV : CHIP_BASE}">All ${Utils.esc(pa?.name || '')}</button>`;
      paCts.forEach(ct => {
        chipsHtml += `<button class="dt-ct-chip" data-ct="${Utils.esc(ct.key)}" style="${activeCt === ct.key ? CHIP_ACTV : CHIP_BASE}">${Utils.esc(ct.name)}</button>`;
      });
      chipsHtml += `</div>`;
    }

    filterBar.innerHTML = tabsHtml + chipsHtml;
  }

  filterBar.addEventListener('click', e => {
    const tab  = e.target.closest('.dt-pa-tab');
    const chip = e.target.closest('.dt-ct-chip');
    if (tab) {
      activePa = tab.dataset.pa;
      activeCt = null;
      renderFilters();
      render();
    } else if (chip) {
      activeCt = chip.dataset.ct || null;
      renderFilters();
      render();
    }
  });

  // ── Helpers ───────────────────────────────────────────────────────────────────

  function formatCaseTypes(caseTypes) {
    if (!caseTypes || caseTypes.length === 0) return 'Universal (all)';
    const labels = caseTypes.map(ct => caseTypeKeyMap.get(ct) || ct);
    if (labels.length <= 2) return labels.join(', ');
    return `${labels.slice(0, 2).join(', ')} +${labels.length - 2} more`;
  }

  // Build the set of case type keys that belong to enabled PAs
  function enabledCaseTypeKeys() {
    const enabledPaIds = new Set(practiceAreas.map(pa => pa.id));
    return new Set(caseTypesData.filter(ct => enabledPaIds.has(ct.practice_area_id)).map(ct => ct.key));
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  function render() {
    let filtered;
    if (activePa === 'all') {
      // Only show templates whose case types belong to enabled PAs (or universal)
      const enabledCtKeys = enabledCaseTypeKeys();
      filtered = templates.filter(t =>
        !t.case_types || t.case_types.length === 0 ||
        t.case_types.some(k => enabledCtKeys.has(k))
      );
    } else if (activePa === '__universal__') {
      filtered = templates.filter(t => !t.case_types || t.case_types.length === 0);
    } else {
      const paCts = new Set(caseTypesData.filter(ct => ct.practice_area_id === activePa).map(ct => ct.key));
      if (activeCt) {
        filtered = templates.filter(t => Array.isArray(t.case_types) && t.case_types.includes(activeCt));
      } else {
        filtered = templates.filter(t => Array.isArray(t.case_types) && t.case_types.some(k => paCts.has(k)));
      }
    }

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
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              </button>
              <button class="btn btn--ghost btn--sm dt-delete-btn" data-id="${t.id}" title="Delete" style="color:var(--color-danger)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/></svg>
              </button>
            </div>` : ''}
        </td>
      </tr>`).join('');
  }

  // ── Add Recommended Templates ─────────────────────────────────────────────────

  async function handleAddRecommended() {
    const toImport = library.filter(item =>
      item.is_recommended &&
      (item.practice_area_key === null || enabledPaKeys.has(item.practice_area_key)) &&
      !importedLibraryIds.has(item.id)
    );

    if (toImport.length === 0) {
      Utils.toast('All recommended templates are already added.', 'info');
      return;
    }

    const confirmed = await Utils.confirm(
      `This will add ${toImport.length} recommended template${toImport.length !== 1 ? 's' : ''} for your enabled practice areas. You can remove any you don't need afterward.`,
      { confirmLabel: 'Add templates' }
    );
    if (!confirmed) return;

    const btn = document.getElementById('btn-add-recommended');
    Utils.setLoading(btn, true);

    const session = await Auth.getSession();
    const res = await fetch('/api/save-doc-template', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body:    JSON.stringify({ action: 'bulk_import', items: toImport }),
    });
    const data = await res.json();
    Utils.setLoading(btn, false);

    if (!res.ok) { Utils.toast(data.error || 'Import failed.', 'error'); return; }
    Utils.toast(`${data.imported} template${data.imported !== 1 ? 's' : ''} added.`, 'success');
    await load();
  }

  // ── Library Picker Modal ──────────────────────────────────────────────────────

  function openLibraryPicker() {
    let libActivePa = 'all';
    let libActiveCt = null;

    function libEnabledCaseTypeKeys() {
      const enabledPaIds = new Set(practiceAreas.map(pa => pa.id));
      return new Set(caseTypesData.filter(ct => enabledPaIds.has(ct.practice_area_id)).map(ct => ct.key));
    }

    function filterLibrary() {
      if (libActivePa === 'all') {
        const enabledCtKeys = libEnabledCaseTypeKeys();
        return library.filter(item =>
          item.practice_area_key === null ||
          (enabledPaKeys.has(item.practice_area_key) &&
            (!item.case_type_keys || item.case_type_keys.length === 0 ||
              item.case_type_keys.some(k => enabledCtKeys.has(k))))
        );
      }
      if (libActivePa === '__universal__') {
        return library.filter(item => item.practice_area_key === null);
      }
      const pa = practiceAreas.find(p => p.id === libActivePa);
      if (!pa) return [];
      const paItems = library.filter(item => item.practice_area_key === pa.key);
      if (libActiveCt) {
        return paItems.filter(item =>
          !item.case_type_keys || item.case_type_keys.length === 0 ||
          item.case_type_keys.includes(libActiveCt)
        );
      }
      return paItems;
    }

    function libFormatCaseTypes(item) {
      if (item.practice_area_key === null) return 'Universal (all)';
      if (!item.case_type_keys || item.case_type_keys.length === 0) {
        const pa = practiceAreas.find(p => p.key === item.practice_area_key);
        return `All ${pa?.name || item.practice_area_key}`;
      }
      const labels = item.case_type_keys.map(k => caseTypeKeyMap.get(k) || k);
      if (labels.length <= 2) return labels.join(', ');
      return `${labels.slice(0, 2).join(', ')} +${labels.length - 2} more`;
    }

    function renderLibFilters(container) {
      let tabsHtml = `<div style="display:flex;gap:0;border-bottom:1px solid var(--color-border);margin-bottom:var(--space-3)">`;
      tabsHtml += `<button class="lib-pa-tab" data-pa="all" style="${libActivePa === 'all' ? TAB_ACTV : TAB_BASE}">All</button>`;
      tabsHtml += `<button class="lib-pa-tab" data-pa="__universal__" style="${libActivePa === '__universal__' ? TAB_ACTV : TAB_BASE}">Universal</button>`;
      practiceAreas.forEach(pa => {
        tabsHtml += `<button class="lib-pa-tab" data-pa="${Utils.esc(pa.id)}" style="${libActivePa === pa.id ? TAB_ACTV : TAB_BASE}">${Utils.esc(pa.name)}</button>`;
      });
      tabsHtml += `</div>`;

      let chipsHtml = '';
      if (libActivePa !== 'all' && libActivePa !== '__universal__') {
        const pa    = practiceAreas.find(p => p.id === libActivePa);
        const paCts = caseTypesData.filter(ct => ct.practice_area_id === libActivePa);
        if (paCts.length) {
          chipsHtml = `<div style="display:flex;gap:var(--space-2);flex-wrap:wrap;padding-bottom:var(--space-2)">`;
          chipsHtml += `<button class="lib-ct-chip" data-ct="" style="${libActiveCt === null ? CHIP_ACTV : CHIP_BASE}">All ${Utils.esc(pa?.name || '')}</button>`;
          paCts.forEach(ct => {
            chipsHtml += `<button class="lib-ct-chip" data-ct="${Utils.esc(ct.key)}" style="${libActiveCt === ct.key ? CHIP_ACTV : CHIP_BASE}">${Utils.esc(ct.name)}</button>`;
          });
          chipsHtml += `</div>`;
        }
      }

      container.innerHTML = tabsHtml + chipsHtml;
    }

    function renderLibItems(container, importBtn) {
      const items = filterLibrary();

      if (!items.length) {
        container.innerHTML = `<div style="padding:var(--space-10);text-align:center;color:var(--color-text-muted)">No templates in library for this selection.</div>`;
        updateImportBtn(importBtn);
        return;
      }

      container.innerHTML = items.map(item => {
        const alreadyImported = importedLibraryIds.has(item.id);
        const checkId = `lib-cb-${item.id}`;
        return `
          <label style="display:flex;align-items:flex-start;gap:var(--space-3);padding:var(--space-3) var(--space-1);border-bottom:1px solid var(--color-border-subtle, var(--color-border));cursor:${alreadyImported ? 'default' : 'pointer'};opacity:${alreadyImported ? '0.45' : '1'}">
            <input type="checkbox" id="${checkId}" class="lib-item-cb" value="${item.id}"
              style="width:auto;flex-shrink:0;margin-top:2px"
              ${alreadyImported ? 'disabled checked' : ''}
              ${item.is_recommended && !alreadyImported ? 'checked' : ''}>
            <div style="flex:1;min-width:0">
              <div style="font-weight:500;font-size:var(--text-sm)">${Utils.esc(item.doc_name)}</div>
              <div style="font-size:var(--text-xs);color:var(--color-text-muted);margin-top:2px">
                ${Utils.esc(libFormatCaseTypes(item))}
                &nbsp;·&nbsp;${Utils.esc(CATEGORY_LABELS[item.doc_category] || item.doc_category)}
                ${alreadyImported ? '&nbsp;·&nbsp;<span style="color:var(--color-success,#16a34a)">Already added</span>' : ''}
                ${item.is_recommended && !alreadyImported ? '&nbsp;·&nbsp;<span style="color:var(--color-primary)">Recommended</span>' : ''}
              </div>
            </div>
            <span style="font-size:var(--text-xs);color:${item.is_required_by_default ? 'var(--color-success,#16a34a)' : 'var(--color-text-muted)'};white-space:nowrap;padding-top:2px">
              ${item.is_required_by_default ? 'Required' : 'Optional'}
            </span>
          </label>`;
      }).join('');

      updateImportBtn(importBtn);
      container.querySelectorAll('.lib-item-cb:not([disabled])').forEach(cb => {
        cb.addEventListener('change', () => updateImportBtn(importBtn));
      });
    }

    function updateImportBtn(btn) {
      const checked = libModal.querySelectorAll('.lib-item-cb:not([disabled]):checked').length;
      btn.textContent = checked > 0 ? `Import selected (${checked})` : 'Import selected';
      btn.disabled    = checked === 0;
    }

    // Build modal shell
    libModal.innerHTML = `
      <div class="modal" style="max-width:700px;width:100%">
        <div class="modal-header">
          <h2 class="modal-title">Browse template library</h2>
          <button class="modal-close" aria-label="Close">×</button>
        </div>
        <div class="modal-body" style="padding-bottom:0">
          <div id="lib-filter-bar" style="margin-bottom:var(--space-2)"></div>
          <div id="lib-items" style="max-height:440px;overflow-y:auto;margin:0 calc(-1 * var(--space-6));padding:0 var(--space-6)"></div>
        </div>
        <div class="modal-footer">
          <button class="btn btn--secondary" id="lib-cancel">Cancel</button>
          <button class="btn btn--primary" id="lib-import" disabled>Import selected</button>
        </div>
      </div>`;

    libModal.classList.remove('hidden');

    const filterBarEl = document.getElementById('lib-filter-bar');
    const itemsEl     = document.getElementById('lib-items');
    const importBtn   = document.getElementById('lib-import');

    renderLibFilters(filterBarEl);
    renderLibItems(itemsEl, importBtn);

    // Delegated filter listener
    filterBarEl.addEventListener('click', e => {
      const tab  = e.target.closest('.lib-pa-tab');
      const chip = e.target.closest('.lib-ct-chip');
      if (tab)  { libActivePa = tab.dataset.pa; libActiveCt = null; renderLibFilters(filterBarEl); renderLibItems(itemsEl, importBtn); }
      if (chip) { libActiveCt = chip.dataset.ct || null; renderLibFilters(filterBarEl); renderLibItems(itemsEl, importBtn); }
    });

    libModal.querySelector('.modal-close').addEventListener('click', closeLibModal);
    document.getElementById('lib-cancel').addEventListener('click', closeLibModal);
    libModal.addEventListener('click', e => { if (e.target === libModal) closeLibModal(); });

    importBtn.addEventListener('click', async () => {
      const selectedIds = [...libModal.querySelectorAll('.lib-item-cb:not([disabled]):checked')].map(cb => cb.value);
      if (!selectedIds.length) return;

      const items = library.filter(item => selectedIds.includes(item.id));
      Utils.setLoading(importBtn, true);

      const session = await Auth.getSession();
      const res = await fetch('/api/save-doc-template', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body:    JSON.stringify({ action: 'bulk_import', items }),
      });
      const data = await res.json();
      Utils.setLoading(importBtn, false);

      if (!res.ok) { Utils.toast(data.error || 'Import failed.', 'error'); return; }
      Utils.toast(`${data.imported} template${data.imported !== 1 ? 's' : ''} added.`, 'success');
      closeLibModal();
      await load();
    });
  }

  function closeLibModal() {
    libModal.classList.add('hidden');
    libModal.innerHTML = '';
  }

  // ── Add / Edit Modal ──────────────────────────────────────────────────────────

  function openModal(template = null) {
    const isEdit       = !!template;
    const isUniversal  = !template?.case_types || template.case_types.length === 0;
    const selectedKeys = template?.case_types || [];

    const catOpts = Object.entries(CATEGORY_LABELS)
      .map(([v, l]) => `<option value="${v}"${template?.doc_category === v ? ' selected' : ''}>${Utils.esc(l)}</option>`).join('');

    const ctCheckboxes = practiceAreas.map(pa => {
      const paCts = caseTypesData.filter(ct => ct.practice_area_id === pa.id);
      if (!paCts.length) return '';
      return `
        <div style="margin-bottom:var(--space-3)">
          <div style="font-size:var(--text-xs);font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-muted);margin-bottom:var(--space-2)">${Utils.esc(pa.name)}</div>
          ${paCts.map(ct => `
            <label style="display:flex;align-items:center;gap:var(--space-2);cursor:pointer;font-weight:400;font-size:var(--text-sm);margin-bottom:var(--space-1)">
              <input type="checkbox" class="dt-ct-cb" value="${Utils.esc(ct.key)}" style="width:auto;flex-shrink:0" ${selectedKeys.includes(ct.key) ? 'checked' : ''}>
              ${Utils.esc(ct.name)}
            </label>`).join('')}
        </div>`;
    }).join('');

    modal.innerHTML = `
      <div class="modal" style="max-width:540px">
        <div class="modal-header">
          <h2 class="modal-title">${isEdit ? 'Edit' : 'Add'} custom template</h2>
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
            <div id="dt-ct-grid" style="display:${isUniversal ? 'none' : 'block'};padding:var(--space-3);background:var(--color-bg-subtle);border-radius:var(--radius);border:1px solid var(--color-border)">
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
      document.getElementById('dt-ct-grid').style.display = e.target.checked ? 'none' : 'block';
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

      const universal = document.getElementById('dt-universal').checked;
      const caseTypes = universal
        ? null
        : [...modal.querySelectorAll('.dt-ct-cb:checked')].map(cb => cb.value);

      if (!universal && caseTypes.length === 0) { ctErr.classList.remove('hidden'); return; }

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
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body:    JSON.stringify(payload),
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
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body:    JSON.stringify({ action: 'delete', id }),
    });
    const data = await res.json();
    if (!res.ok) { Utils.toast(data.error || 'Delete failed.', 'error'); return; }
    Utils.toast('Template item deleted.', 'success');
    await load();
  }

  // ── Event wiring ──────────────────────────────────────────────────────────────

  document.getElementById('btn-add-template').addEventListener('click',    () => openModal());
  document.getElementById('btn-add-recommended').addEventListener('click', handleAddRecommended);
  document.getElementById('btn-browse-library').addEventListener('click',  openLibraryPicker);

  tbody.addEventListener('click', e => {
    const editBtn   = e.target.closest('.dt-edit-btn');
    const deleteBtn = e.target.closest('.dt-delete-btn');
    if (editBtn)   { const t = templates.find(t => t.id === editBtn.dataset.id);   if (t) openModal(t); }
    if (deleteBtn) { deleteTemplate(deleteBtn.dataset.id); }
  });

  // ── Init ──────────────────────────────────────────────────────────────────────

  await Promise.all([loadReferenceData(), loadLibrary()]);
  await load();

})();
