'use strict';

// Settings > Firm Profile — edits the firm_settings singleton directly via
// supabase-js (RLS: authenticated read, Owner-only write; see migration 1513).
// This row is the `firm.*` data source for USCIS form autofill and document
// drafting, so saving here updates every future generated form.

(function () {

  const form = document.getElementById('firm-profile-form');
  if (!form) return;

  const FIELDS = ['firm_name', 'address_line1', 'address_line2', 'city', 'state', 'zip', 'phone', 'fax', 'email', 'website'];
  let rowId = null;

  // Built-in Files-tab folders a firm may hide (keys mirror detail.js
  // MATTER_FOLDERS; 'all' and 'client_uploads' are structural and always shown).
  const HIDEABLE_BUILTINS = [
    { key: 'pleadings',      label: 'Pleadings' },
    { key: 'agreements',     label: 'Agreements' },
    { key: 'correspondence', label: 'Correspondence' },
    { key: 'financial',      label: 'Financial' },
    { key: 'attorney_notes', label: 'Attorney Notes' },
    { key: 'court_orders',   label: 'Court Orders' },
    { key: 'trial_docs',     label: 'Trial Docs' },
    { key: 'admin',          label: 'Admin' },
    { key: 'other',          label: 'Other' },
  ];

  async function load() {
    const { data, error } = await db.from('firm_settings').select('*').limit(1).maybeSingle();
    if (error) { Utils.toast('Failed to load firm profile: ' + error.message, 'error'); return; }
    renderFolderSettings(data);
    if (!data) return; // singleton row is seeded by migration 1513; treat missing as blank
    rowId = data.id;
    for (const f of FIELDS) {
      if (form.elements[f]) form.elements[f].value = data[f] || '';
    }
  }

  // ── Matter Folders card ─────────────────────────────────────────────────────

  function renderFolderSettings(data) {
    const listEl = document.getElementById('ff-builtin-list');
    const textEl = document.getElementById('ff-default-folders');
    if (!listEl || !textEl) return;

    const defaults = Array.isArray(data?.default_matter_folders) ? data.default_matter_folders : [];
    const hidden   = new Set(Array.isArray(data?.hidden_builtin_folders) ? data.hidden_builtin_folders : []);

    textEl.value = defaults.join('\n');
    // Docket kit: each hideable built-in folder is a slider (checked = shown).
    // Keep data-builtin on the real checkbox so the save handler's selector still resolves.
    listEl.innerHTML = HIDEABLE_BUILTINS.map(f => `
      <label style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3);cursor:pointer;font-size:var(--text-sm);padding:var(--space-1) 0">
        <span>${f.label}</span>
        ${DK.toggle(`data-builtin="${f.key}"`, !hidden.has(f.key))}
      </label>`).join('');
  }

  document.getElementById('firm-folders-form')?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl   = document.getElementById('ff-error');
    const saveBtn = document.getElementById('ff-save');
    errEl.classList.add('hidden');
    Utils.setLoading(saveBtn, true);

    const default_matter_folders = document.getElementById('ff-default-folders').value
      .split('\n').map(s => s.trim()).filter(Boolean);
    const hidden_builtin_folders = [...document.querySelectorAll('#ff-builtin-list input[data-builtin]')]
      .filter(cb => !cb.checked).map(cb => cb.dataset.builtin);

    try {
      const profile = await Auth.getProfile();
      const update  = { default_matter_folders, hidden_builtin_folders, updated_by: profile?.id || null };
      let error;
      if (rowId) {
        ({ error } = await db.from('firm_settings').update(update).eq('id', rowId));
      } else {
        ({ error } = await db.from('firm_settings').insert(update));
      }
      if (error) throw error;
      Utils.toast('Matter folder settings saved. New matters will use this layout.', 'success');
      if (!rowId) load();
    } catch (err) {
      errEl.textContent = err.message || 'Save failed.';
      errEl.classList.remove('hidden');
    } finally {
      Utils.setLoading(saveBtn, false);
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const errEl   = document.getElementById('fp-error');
    const saveBtn = document.getElementById('fp-save');
    errEl.classList.add('hidden');
    Utils.setLoading(saveBtn, true);

    const update = {};
    for (const f of FIELDS) update[f] = form.elements[f].value.trim() || null;

    try {
      const profile = await Auth.getProfile();
      update.updated_by = profile?.id || null;
      let error;
      if (rowId) {
        ({ error } = await db.from('firm_settings').update(update).eq('id', rowId));
      } else {
        ({ error } = await db.from('firm_settings').insert(update));
      }
      if (error) throw error;
      Utils.toast('Firm profile saved. New forms will use this information.', 'success');
      if (!rowId) load();
    } catch (err) {
      errEl.textContent = err.message || 'Save failed.';
      errEl.classList.remove('hidden');
    } finally {
      Utils.setLoading(saveBtn, false);
    }
  });

  load();
})();
