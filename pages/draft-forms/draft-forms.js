'use strict';

// USCIS Forms module landing page. Matter-scoped generate/review/finalize
// lives on the matter detail page's "USCIS Forms" tab (see
// pages/clients/detail/detail.js — wireFormFillerTab/loadFormFiller). This
// page hosts the firm-level Template Defaults manager: download a fillable
// template, set the standing answers in any PDF viewer, upload it back
// (POST /api/form-filler/template-defaults stores them as firm_overrides).

(function () {

  const container = document.getElementById('ff-template-defaults-list');
  if (!container) return;

  async function api(path, opts = {}) {
    const session = await Auth.getSession();
    const res = await fetch(path, {
      ...opts,
      headers: { 'Authorization': `Bearer ${session.access_token}`, ...(opts.headers || {}) },
    });
    return res;
  }

  function renderRow(t) {
    const ready = t.template_ready;
    const statusTag = !ready
      ? DK.tag('Not yet available', 'mut')
      : (t.firm_defaults ? DK.tag('Defaults uploaded', 'ok') : DK.tag('Using blank form', 'mut'));

    const fieldsBit = `<span>${t.data_mapped} autofilled field${t.data_mapped === 1 ? '' : 's'}</span>`;
    const defaultsBit = t.firm_defaults
      ? `<span class="sep">·</span><span>${t.firm_defaults} firm default${t.firm_defaults === 1 ? '' : 's'} set</span>`
      : `<span class="sep">·</span><span>No firm defaults yet</span>`;

    const act = ready
      ? `<button class="dk-linkbtn" data-act="download" data-id="${t.template_id}" data-key="${Utils.esc(t.form_key)}">Download</button>
         <button class="dk-linkbtn" data-act="upload" data-id="${t.template_id}" data-key="${Utils.esc(t.form_key)}">Upload edited</button>`
      : `<span class="dk-reg-meta">Coming soon</span>`;

    return `
      <div class="dk-reg-row">
        <div style="min-width:0">
          <div class="dk-reg-title"><span>${Utils.esc(t.label)}</span>${statusTag}</div>
          <div class="dk-reg-meta">${fieldsBit}${defaultsBit}</div>
        </div>
        <div class="dk-reg-act">${act}</div>
      </div>`;
  }

  async function loadList() {
    container.innerHTML = `<div class="dk-empty">Loading templates…</div>`;
    let data;
    try {
      const res = await api('/api/form-filler/template-defaults');
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || `Error ${res.status}`);
      data = await res.json();
    } catch (err) {
      container.innerHTML = `<div class="dk-empty" style="color:var(--color-danger)">Failed to load: ${Utils.esc(err.message)}</div>`;
      return;
    }

    if (!data.templates.length) {
      container.innerHTML = `<div class="dk-empty">No form templates configured yet.</div>`;
      return;
    }

    container.innerHTML = `
      <div class="dk-register">
        ${data.templates.map(renderRow).join('')}
      </div>
      <input type="file" id="ff-defaults-file" accept="application/pdf" style="display:none">`;

    container.querySelectorAll('button[data-act="download"]').forEach(btn => {
      btn.addEventListener('click', () => downloadTemplate(btn));
    });
    container.querySelectorAll('button[data-act="upload"]').forEach(btn => {
      btn.addEventListener('click', () => pickAndUpload(btn));
    });
  }

  async function downloadTemplate(btn) {
    const orig = btn.textContent;
    btn.disabled = true;
    btn.textContent = 'Preparing…';
    try {
      const res = await api(`/api/form-filler/template-defaults?template_id=${encodeURIComponent(btn.dataset.id)}`);
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || `Error ${res.status}`);
      const blob = await res.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url;
      a.download = `${btn.dataset.key}-template-defaults.pdf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 60000);
    } catch (err) {
      Utils.toast(err.message || 'Download failed.', 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = orig;
    }
  }

  function pickAndUpload(btn) {
    const input = document.getElementById('ff-defaults-file');
    input.onchange = async () => {
      const file = input.files[0];
      input.value = '';
      if (!file) return;
      const orig = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        const res = await api(`/api/form-filler/template-defaults?template_id=${encodeURIComponent(btn.dataset.id)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/pdf' },
          body: file,
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
        let msg = `${body.saved} default${body.saved === 1 ? '' : 's'} saved for ${btn.dataset.key.toUpperCase()}.`;
        if (body.ignored_data_mapped) msg += ` ${body.ignored_data_mapped} autofilled field${body.ignored_data_mapped === 1 ? '' : 's'} ignored.`;
        Utils.toast(msg, 'success');
        loadList();
      } catch (err) {
        Utils.toast(err.message || 'Upload failed.', 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
      }
    };
    input.click();
  }

  loadList();
})();


// ── Case Builder ──────────────────────────────────────────────────────────────
// Two-pane authoring for the firm's reusable case templates: case types on the
// left, the selected type's packages and their ordered form lists on the right.
// Reads/writes /api/case-builder/* (admin on draft_forms). Per-matter add/remove
// stays on the matter's USCIS Forms tab — this only sets the starting point.
(function () {

  const root = document.getElementById('case-builder-root');
  if (!root) return;

  let data = { practice_areas: [], case_types: [], templates: [] };
  let templateById = {};
  let selectedCaseTypeId = null;

  async function api(path, opts = {}) {
    const session = await Auth.getSession();
    const res = await fetch(path, {
      ...opts,
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        ...(opts.body ? { 'Content-Type': 'application/json' } : {}),
        ...(opts.headers || {}),
      },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `Error ${res.status}`);
    return body;
  }

  async function load() {
    root.innerHTML = `<div class="dk-empty">Loading Case Builder…</div>`;
    try {
      data = await api('/api/case-builder/packages');
    } catch (err) {
      root.innerHTML = `<div class="dk-empty" style="color:var(--color-danger)">Failed to load: ${Utils.esc(err.message)}</div>`;
      return;
    }
    templateById = {};
    for (const t of data.templates) templateById[t.id] = t;

    // Keep the current selection if it still exists, else fall back to the first.
    if (!data.case_types.some(ct => ct.id === selectedCaseTypeId)) {
      selectedCaseTypeId = data.case_types[0]?.id || null;
    }
    render();
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  function render() {
    root.innerHTML = renderToolbar() + `<div id="cb-detail">${renderDetail()}</div>`;
    wire();
  }

  // Case types are a dropdown, not a scrolling list: immigration alone has 20+
  // and a full-height register pushed the packages (and the sections below)
  // off-screen. Option text carries the package count so the picker still tells
  // you at a glance which types are built out.
  function renderToolbar() {
    const opts = data.case_types.map(ct => {
      const n = ct.packages.length;
      const flag = ct.active === false ? ' — inactive' : '';
      return `<option value="${Utils.esc(ct.id)}" ${ct.id === selectedCaseTypeId ? 'selected' : ''}>${Utils.esc(ct.name)} (${n} package${n === 1 ? '' : 's'})${flag}</option>`;
    }).join('');

    const select = data.case_types.length
      ? `<select id="cb-ct-select" style="min-width:300px;max-width:440px;padding:8px 10px;border:1px solid var(--line);border-radius:8px;background:var(--paper);color:var(--ink);font-size:14px">${opts}</select>`
      : `<span class="dk-reg-meta">No immigration case types yet.</span>`;

    return `
      <div class="dk-sec-head" style="margin-bottom:18px;gap:12px;flex-wrap:wrap">
        <label for="cb-ct-select" style="font-size:13px;font-weight:600;color:var(--ink-soft)">Case type</label>
        ${select}
        <span class="dk-sec-rule"></span>
        <button id="cb-new-ct" class="dk-sec-add">+ New case type</button>
      </div>`;
  }

  function renderDetail() {
    const ct = data.case_types.find(c => c.id === selectedCaseTypeId);
    if (!ct) return `<div class="dk-empty">Select a case type, or create one.</div>`;

    const packages = [...ct.packages].sort((a, b) =>
      (b.is_default - a.is_default) || a.name.localeCompare(b.name));

    const inactiveTag = ct.active === false ? DK.tag('Inactive', 'mut') : '';
    const head = `
      <div class="dk-sec-head" style="margin-bottom:14px">
        <h2 style="font-size:15px">${Utils.esc(ct.name)}</h2>${inactiveTag}
        <span class="dk-sec-count">${Utils.esc(ct.key)}</span>
        <span class="dk-sec-rule"></span>
        <button class="dk-linkbtn cb-ct-toggle" data-id="${Utils.esc(ct.id)}" data-active="${ct.active ? '1' : '0'}">${ct.active ? 'Deactivate' : 'Reactivate'}</button>
        <button class="dk-linkbtn d cb-ct-delete" data-id="${Utils.esc(ct.id)}" data-name="${Utils.esc(ct.name)}">Delete</button>
        <button id="cb-new-pkg" class="dk-sec-add">+ New package</button>
      </div>`;

    const body = packages.length
      ? packages.map(renderPackage).join('')
      : `<div class="dk-empty">No packages yet. Create one — its forms become the starting list for new ${Utils.esc(ct.name)} matters.</div>`;

    return head + body;
  }

  function renderPackage(pkg) {
    const items = [...(pkg.items || [])].sort((a, b) => a.sort_order - b.sort_order);
    const badge = pkg.is_default ? DK.tag('Default', 'ok') : '';
    const inactive = pkg.active === false ? DK.tag('Inactive', 'mut') : '';

    const formRows = items.map((it, i) => {
      const t = templateById[it.template_id];
      const label = t ? t.label : '(unknown form)';
      const warn = t && t.uploaded === false ? DK.tag('No PDF', 'warn') : '';
      const code = t ? String(t.form_key || '').toUpperCase() : '';
      return `
        <div class="dk-reg-row">
          <div style="min-width:0">
            <div class="dk-reg-title"><span>${Utils.esc(label)}</span>${warn}</div>
            <div class="dk-reg-meta"><span>${Utils.esc(code)}</span></div>
          </div>
          <div class="dk-reg-act">
            <button class="dk-linkbtn cb-move" data-pkg="${Utils.esc(pkg.id)}" data-i="${i}" data-dir="-1" ${i === 0 ? 'disabled style="opacity:.35"' : ''} title="Move up">↑</button>
            <button class="dk-linkbtn cb-move" data-pkg="${Utils.esc(pkg.id)}" data-i="${i}" data-dir="1" ${i === items.length - 1 ? 'disabled style="opacity:.35"' : ''} title="Move down">↓</button>
            <span aria-hidden="true" style="width:1px;align-self:stretch;margin:0 2px;background:var(--line)"></span>
            <button class="dk-linkbtn d cb-remove" data-pkg="${Utils.esc(pkg.id)}" data-tid="${Utils.esc(it.template_id)}">Remove</button>
          </div>
        </div>`;
    }).join('');

    return `
      <div style="border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin-bottom:16px">
        <div class="dk-reg-title" style="justify-content:space-between">
          <span style="display:flex;align-items:center;gap:8px">${Utils.esc(pkg.name)}${badge}${inactive}</span>
          <span class="dk-reg-act">
            ${pkg.is_default ? '' : `<button class="dk-linkbtn cb-setdefault" data-id="${Utils.esc(pkg.id)}">Make default</button>`}
            <button class="dk-linkbtn cb-rename" data-id="${Utils.esc(pkg.id)}">Rename</button>
            <button class="dk-linkbtn cb-pkg-toggle" data-id="${Utils.esc(pkg.id)}" data-active="${pkg.active ? '1' : '0'}">${pkg.active ? 'Deactivate' : 'Reactivate'}</button>
          </span>
        </div>
        ${pkg.description ? `<div class="dk-reg-meta" style="margin:2px 0 12px">${Utils.esc(pkg.description)}</div>` : '<div style="height:10px"></div>'}
        ${items.length ? `<div class="dk-register">${formRows}</div>` : `<div class="dk-empty" style="padding:12px 0">No forms yet.</div>`}
        <div style="margin-top:12px">
          <button class="dk-sec-add cb-addforms" data-id="${Utils.esc(pkg.id)}">+ Add forms</button>
        </div>
      </div>`;
  }

  // ── Wire ──────────────────────────────────────────────────────────────────────
  function wire() {
    document.getElementById('cb-new-ct')?.addEventListener('click', newCaseType);
    document.getElementById('cb-new-pkg')?.addEventListener('click', () => newPackage(selectedCaseTypeId));

    document.getElementById('cb-ct-select')?.addEventListener('change', (e) => {
      selectedCaseTypeId = e.target.value;
      render();
    });

    root.querySelector('.cb-ct-toggle')?.addEventListener('click', (e) => {
      const b = e.currentTarget;
      saveCaseType({ id: b.dataset.id, active: b.dataset.active !== '1' });
    });

    root.querySelector('.cb-ct-delete')?.addEventListener('click', (e) => {
      const b = e.currentTarget;
      deleteCaseType(b.dataset.id, b.dataset.name);
    });

    root.querySelectorAll('.cb-setdefault').forEach(b =>
      b.addEventListener('click', () => savePackage({ id: b.dataset.id, is_default: true })));
    root.querySelectorAll('.cb-rename').forEach(b =>
      b.addEventListener('click', () => renamePackage(b.dataset.id)));
    root.querySelectorAll('.cb-pkg-toggle').forEach(b =>
      b.addEventListener('click', () => savePackage({ id: b.dataset.id, active: b.dataset.active !== '1' })));
    root.querySelectorAll('.cb-addforms').forEach(b =>
      b.addEventListener('click', () => addForms(b.dataset.id)));
    root.querySelectorAll('.cb-remove').forEach(b =>
      b.addEventListener('click', () => removeForm(b.dataset.pkg, b.dataset.tid)));
    root.querySelectorAll('.cb-move').forEach(b =>
      b.addEventListener('click', () => moveForm(b.dataset.pkg, +b.dataset.i, +b.dataset.dir)));
  }

  // ── Item list helpers ───────────────────────────────────────────────────────
  function pkgById(id) {
    for (const ct of data.case_types) {
      const p = ct.packages.find(x => x.id === id);
      if (p) return p;
    }
    return null;
  }

  function orderedItems(pkg) {
    return [...(pkg.items || [])]
      .sort((a, b) => a.sort_order - b.sort_order)
      .map(it => ({ template_id: it.template_id, required: it.required }));
  }

  async function saveItems(packageId, items) {
    await api('/api/case-builder/package-items', {
      method: 'POST',
      body: JSON.stringify({ package_id: packageId, items }),
    });
    await load();
  }

  function addForms(packageId) {
    const pkg = pkgById(packageId);
    if (!pkg) return;
    const have = new Set((pkg.items || []).map(i => i.template_id));
    FormPicker.open({
      title: `Add forms to “${pkg.name}”`,
      templates: data.templates,
      excludeIds: [...have],
      confirmLabel: 'Add',
      onConfirm: async (ids) => {
        const items = orderedItems(pkg).concat(ids.map(id => ({ template_id: id, required: true })));
        await saveItems(packageId, items);
        Utils.toast(`${ids.length} form${ids.length === 1 ? '' : 's'} added.`, 'success');
      },
    });
  }

  async function removeForm(packageId, templateId) {
    const pkg = pkgById(packageId);
    if (!pkg) return;
    const items = orderedItems(pkg).filter(it => it.template_id !== templateId);
    try { await saveItems(packageId, items); }
    catch (err) { Utils.toast(err.message, 'error'); }
  }

  async function moveForm(packageId, index, dir) {
    const pkg = pkgById(packageId);
    if (!pkg) return;
    const items = orderedItems(pkg);
    const j = index + dir;
    if (j < 0 || j >= items.length) return;
    [items[index], items[j]] = [items[j], items[index]];
    try { await saveItems(packageId, items); }
    catch (err) { Utils.toast(err.message, 'error'); }
  }

  // ── Writes: case types & packages ──────────────────────────────────────────
  async function saveCaseType(payload) {
    try {
      const r = await api('/api/case-builder/case-type', { method: 'POST', body: JSON.stringify(payload) });
      if (r.created) selectedCaseTypeId = r.case_type.id;
      Utils.toast(r.created ? 'Case type created.' : 'Case type updated.', 'success');
      await load();
    } catch (err) { Utils.toast(err.message, 'error'); }
  }

  async function deleteCaseType(id, name) {
    const ok = await Utils.confirm(
      `Delete the case type “${name}”? This permanently removes it and all of its packages — it can't be undone. (A case type still used by a matter or appointment can't be deleted; deactivate it instead.)`,
      { confirmLabel: 'Delete case type', danger: true });
    if (!ok) return;
    try {
      await api('/api/case-builder/case-type', { method: 'DELETE', body: JSON.stringify({ id }) });
      if (selectedCaseTypeId === id) selectedCaseTypeId = null;
      Utils.toast('Case type deleted.', 'success');
      await load();
    } catch (err) { Utils.toast(err.message, 'error'); }
  }

  async function savePackage(payload) {
    try {
      await api('/api/case-builder/package', { method: 'POST', body: JSON.stringify(payload) });
      Utils.toast(payload.id ? 'Package updated.' : 'Package created.', 'success');
      await load();
    } catch (err) { Utils.toast(err.message, 'error'); }
  }

  async function newCaseType() {
    const vals = await cbModal({
      title: 'New immigration case type',
      confirmLabel: 'Create',
      fields: [
        { name: 'name', label: 'Name', type: 'text', placeholder: 'e.g. Adjustment of Status', required: true },
      ],
    });
    if (!vals) return;
    saveCaseType({ name: vals.name });
  }

  async function newPackage(caseTypeId) {
    if (!caseTypeId) return;
    const vals = await cbModal({
      title: 'New package',
      confirmLabel: 'Create',
      fields: [
        { name: 'name', label: 'Name', type: 'text', placeholder: 'e.g. Standard, or “I-130 already filed”', required: true },
        { name: 'description', label: 'Description (optional)', type: 'textarea' },
      ],
    });
    if (!vals) return;
    savePackage({ case_type_id: caseTypeId, name: vals.name, description: vals.description });
  }

  async function renamePackage(packageId) {
    const pkg = pkgById(packageId);
    if (!pkg) return;
    const vals = await cbModal({
      title: 'Rename package',
      confirmLabel: 'Save',
      fields: [
        { name: 'name', label: 'Name', type: 'text', value: pkg.name, required: true },
        { name: 'description', label: 'Description (optional)', type: 'textarea', value: pkg.description || '' },
      ],
    });
    if (!vals) return;
    savePackage({ id: packageId, name: vals.name, description: vals.description });
  }

  // ── Small form modal (create/rename) ───────────────────────────────────────
  function cbModal({ title, fields, confirmLabel = 'Save' }) {
    return new Promise((resolve) => {
      let overlay = document.getElementById('cb-modal');
      if (!overlay) {
        overlay = document.createElement('div');
        overlay.id = 'cb-modal';
        overlay.className = 'modal-overlay hidden';
        overlay.setAttribute('role', 'dialog');
        overlay.setAttribute('aria-modal', 'true');
        document.body.appendChild(overlay);
      }

      const fieldHtml = fields.map(f => {
        const id = `cb-f-${f.name}`;
        if (f.type === 'select') {
          return `<div class="field"><label for="${id}">${Utils.esc(f.label)}</label>
            <select id="${id}">${(f.options || []).map(o => `<option value="${Utils.esc(String(o.value))}">${Utils.esc(o.label)}</option>`).join('')}</select></div>`;
        }
        if (f.type === 'textarea') {
          return `<div class="field"><label for="${id}">${Utils.esc(f.label)}</label>
            <textarea id="${id}" rows="2">${Utils.esc(f.value || '')}</textarea></div>`;
        }
        return `<div class="field"><label for="${id}">${Utils.esc(f.label)}</label>
          <input type="text" id="${id}" value="${Utils.esc(f.value || '')}" placeholder="${Utils.esc(f.placeholder || '')}" autocomplete="off"></div>`;
      }).join('');

      overlay.innerHTML = `
        <div class="modal">
          <div class="modal-header">
            <h2 class="modal-title">${Utils.esc(title)}</h2>
            <button class="modal-close" aria-label="Close">&times;</button>
          </div>
          <div class="modal-body"><div class="field-stack">${fieldHtml}</div></div>
          <div class="modal-footer">
            <button type="button" class="btn btn--secondary" id="cb-modal-cancel">Cancel</button>
            <button type="button" class="btn btn--primary" id="cb-modal-ok">${Utils.esc(confirmLabel)}</button>
          </div>
        </div>`;

      function close(result) { overlay.classList.add('hidden'); overlay.innerHTML = ''; resolve(result); }

      overlay.querySelector('#cb-modal-ok').addEventListener('click', () => {
        const vals = {};
        for (const f of fields) {
          const el = overlay.querySelector(`#cb-f-${f.name}`);
          vals[f.name] = (el.value || '').trim();
          if (f.required && !vals[f.name]) { el.focus(); return; }
        }
        close(vals);
      });
      overlay.querySelector('#cb-modal-cancel').addEventListener('click', () => close(null));
      overlay.querySelector('.modal-close').addEventListener('click', () => close(null));
      overlay.addEventListener('click', e => { if (e.target === overlay) close(null); });

      overlay.classList.remove('hidden');
      overlay.querySelector(`#cb-f-${fields[0].name}`)?.focus();
    });
  }

  load();
})();
