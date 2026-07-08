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

  async function loadList() {
    container.innerHTML = `<p style="font-size:var(--text-sm);color:var(--color-text-muted)">Loading templates…</p>`;
    let data;
    try {
      const res = await api('/api/form-filler/template-defaults');
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))).error) || `Error ${res.status}`);
      data = await res.json();
    } catch (err) {
      container.innerHTML = `<p style="color:var(--color-danger);font-size:var(--text-sm)">Failed to load: ${Utils.esc(err.message)}</p>`;
      return;
    }

    if (!data.templates.length) {
      container.innerHTML = `<p style="font-size:var(--text-sm);color:var(--color-text-muted)">No form templates configured yet.</p>`;
      return;
    }

    container.innerHTML = `
      <table class="data-table" style="width:100%">
        <thead>
          <tr><th>Form</th><th>Autofilled fields</th><th>Firm defaults</th><th style="text-align:right">Template</th></tr>
        </thead>
        <tbody>
          ${data.templates.map(t => `
            <tr>
              <td style="font-size:var(--text-sm)">${Utils.esc(t.label)}</td>
              <td style="font-size:var(--text-sm)">${t.data_mapped}</td>
              <td style="font-size:var(--text-sm)">${t.firm_defaults ? `${t.firm_defaults} set` : '<span style="color:var(--color-text-muted)">none</span>'}</td>
              <td style="text-align:right;white-space:nowrap">
                ${t.template_ready ? `
                  <button class="btn btn--sm" data-act="download" data-id="${t.template_id}" data-key="${Utils.esc(t.form_key)}">Download</button>
                  <button class="btn btn--sm" data-act="upload" data-id="${t.template_id}" data-key="${Utils.esc(t.form_key)}">Upload edited</button>
                ` : '<span style="font-size:var(--text-xs);color:var(--color-text-muted)">not yet available</span>'}
              </td>
            </tr>`).join('')}
        </tbody>
      </table>
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
