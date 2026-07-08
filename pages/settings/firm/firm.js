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

  async function load() {
    const { data, error } = await db.from('firm_settings').select('*').limit(1).maybeSingle();
    if (error) { Utils.toast('Failed to load firm profile: ' + error.message, 'error'); return; }
    if (!data) return; // singleton row is seeded by migration 1513; treat missing as blank
    rowId = data.id;
    for (const f of FIELDS) {
      if (form.elements[f]) form.elements[f].value = data[f] || '';
    }
  }

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
