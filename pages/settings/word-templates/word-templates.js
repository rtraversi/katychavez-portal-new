'use strict';

// Settings → Word Templates. Manages draft_templates as a library of .docx
// starter/merge documents. These feed the matter "New from Template" action
// (pure copy into a Files folder) and the older drafting flow. Staff upload a
// .docx per template; optional {{placeholders}} auto-fill later. Reading uses
// can_read('core'); .docx upload / attorney assignment go through the
// doc_drafting-gated Worker endpoints.
(async function WordTemplatesPage() {

  let draftAttorneys = [];
  let canWrite       = false;
  let _uploadingId   = null;

  const tbody         = document.getElementById('drafting-templates-tbody');
  const docxFileInput = document.getElementById('docx-file-input');

  const CAT_LABELS = {
    petition: 'Petition', letter: 'Letter', agreement: 'Agreement',
    order: 'Order', financial: 'Financial', other: 'Other',
  };
  const CATEGORIES = Object.keys(CAT_LABELS);

  const profile  = await Auth.getProfile();
  const roleName = profile?.role?.name || '';
  canWrite = ['Owner', 'Attorney', 'Partner Attorney'].includes(roleName);

  // "New Word Template" add-button, injected into the section head (Docket kit).
  if (canWrite) {
    const secHead = document.getElementById('wt-sec-head');
    if (secHead && !document.getElementById('btn-new-word-template')) {
      const btn = document.createElement('button');
      btn.className = 'dk-sec-add';
      btn.id = 'btn-new-word-template';
      btn.type = 'button';
      btn.textContent = '＋ New Word template';
      secHead.appendChild(btn);
      btn.addEventListener('click', openNewTemplateModal);
    }
  }

  function attyOptions(selected) {
    return `<option value="" ${!selected ? 'selected' : ''}>All attorneys</option>` +
      draftAttorneys.map(a => {
        const ini = Utils.initials(a);
        return `<option value="${ini}" ${selected === ini ? 'selected' : ''}>${ini} — ${Utils.esc(Utils.fullName(a))}</option>`;
      }).join('');
  }

  async function load() {
    const [{ data, error }, { data: users }] = await Promise.all([
      db.from('draft_templates')
        .select('id, name, doc_category, assigned_attorney_initials, template_docx_r2_key')
        .order('sort_order'),
      db.from('users').select('id, first_name, last_name, roles(name)').eq('active', true).order('first_name'),
    ]);
    draftAttorneys = (users || []).filter(u => ['Owner', 'Attorney', 'Partner Attorney'].includes(u.roles?.name));

    if (error) {
      tbody.innerHTML = `<div class="dk-empty" style="color:var(--color-danger)">Failed to load templates.</div>`;
      return;
    }
    if (!data || data.length === 0) {
      tbody.innerHTML = `<div class="dk-empty">No Word templates yet.${canWrite ? ' Use “New Word template” to add one.' : ''}</div>`;
      return;
    }

    tbody.innerHTML = data.map(t => {
      const hasDocx  = !!t.template_docx_r2_key;
      const docxTag  = hasDocx ? DK.tag('.docx uploaded', 'ok') : DK.tag('No .docx yet', 'mut');
      const attyCell = canWrite
        ? `<select class="draft-atty-sel" data-id="${t.id}" style="width:auto;font-size:var(--text-sm);padding:var(--space-1) var(--space-2)">${attyOptions(t.assigned_attorney_initials)}</select>`
        : t.assigned_attorney_initials
          ? Utils.esc(t.assigned_attorney_initials)
          : 'All attorneys';
      const actions = canWrite
        ? `<button class="dk-linkbtn docx-upload-btn" data-id="${Utils.esc(t.id)}" type="button">${hasDocx ? 'Replace .docx' : 'Upload .docx'}</button>
           <button class="dk-linkbtn d tmpl-delete-btn" data-id="${Utils.esc(t.id)}" data-name="${Utils.esc(t.name)}" type="button">Delete</button>`
        : '';
      return `<div class="dk-reg-row">
        <div>
          <div class="dk-reg-title">${Utils.esc(t.name)} ${docxTag}</div>
          <div class="dk-reg-meta">
            <span>${CAT_LABELS[t.doc_category] || Utils.esc(t.doc_category)}</span>
            <span class="sep">·</span>
            <span>${attyCell}</span>
          </div>
        </div>
        ${actions ? `<div class="dk-reg-act">${actions}</div>` : ''}
      </div>`;
    }).join('');
  }

  // ── New template (name + category) ─────────────────────────────────────────
  function openNewTemplateModal() {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;inset:0;z-index:1100;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:var(--space-4)';
    overlay.innerHTML = `
      <div class="card" style="max-width:420px;width:100%" role="dialog" aria-modal="true">
        <h3 style="font-size:var(--text-base);font-weight:600;margin-bottom:var(--space-3)">New Word template</h3>
        <label style="display:block;font-size:var(--text-sm);font-weight:500;margin-bottom:4px">Name</label>
        <input id="wt-name" type="text" placeholder="e.g. Engagement Letter"
          style="width:100%;box-sizing:border-box;padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius);font-size:var(--text-sm);font-family:inherit;margin-bottom:var(--space-3)">
        <label style="display:block;font-size:var(--text-sm);font-weight:500;margin-bottom:4px">Category</label>
        <select id="wt-cat" style="width:100%;box-sizing:border-box;padding:var(--space-2) var(--space-3);border:1px solid var(--color-border);border-radius:var(--radius);font-size:var(--text-sm);font-family:inherit;margin-bottom:var(--space-4)">
          ${CATEGORIES.map(c => `<option value="${c}">${CAT_LABELS[c]}</option>`).join('')}
        </select>
        <p style="font-size:var(--text-xs);color:var(--color-text-muted);margin-bottom:var(--space-4)">You'll upload the .docx file after creating the template.</p>
        <div style="display:flex;gap:var(--space-2);justify-content:flex-end">
          <button class="btn btn--ghost" data-cancel>Cancel</button>
          <button class="btn btn--primary" data-save>Create</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('[data-cancel]').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
    overlay.querySelector('#wt-name').focus();

    overlay.querySelector('[data-save]').addEventListener('click', async () => {
      const name = overlay.querySelector('#wt-name').value.trim();
      const cat  = overlay.querySelector('#wt-cat').value;
      if (!name) { Utils.toast('Enter a template name.', 'error'); return; }
      overlay.querySelector('[data-save]').disabled = true;
      // template_html is NOT NULL in the schema (legacy HTML flow) — store an
      // empty string; these templates live entirely in the .docx.
      const { error } = await db.from('draft_templates')
        .insert({ name, doc_category: cat, template_html: '', active: true, sort_order: 0 });
      if (error) { Utils.toast(error.message, 'error'); overlay.querySelector('[data-save]').disabled = false; return; }
      Utils.toast('Template created — upload its .docx next.', 'success');
      close();
      await load();
    });
  }

  // ── Table interactions ─────────────────────────────────────────────────────
  tbody.addEventListener('change', async e => {
    const sel = e.target.closest('.draft-atty-sel');
    if (!sel) return;
    const session = await Auth.getSession();
    const res = await fetch('/api/save-draft-template-attorney', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
      body:    JSON.stringify({ id: sel.dataset.id, assigned_attorney_initials: sel.value || null }),
    });
    const data = await res.json();
    if (!res.ok) { Utils.toast(data.error || 'Save failed.', 'error'); return; }
    Utils.toast('Template updated.', 'success');
  });

  tbody.addEventListener('click', async e => {
    const uploadBtn = e.target.closest('.docx-upload-btn');
    if (uploadBtn) { _uploadingId = uploadBtn.dataset.id; docxFileInput.click(); return; }

    const delBtn = e.target.closest('.tmpl-delete-btn');
    if (delBtn) {
      if (!await Utils.confirm(`Delete the template “${delBtn.dataset.name}”? Documents already created from it are not affected.`, { confirmLabel: 'Delete', danger: true })) return;
      const { error } = await db.from('draft_templates').delete().eq('id', delBtn.dataset.id);
      if (error) { Utils.toast(error.message, 'error'); return; }
      Utils.toast('Template deleted.', 'success');
      await load();
    }
  });

  docxFileInput.addEventListener('change', async () => {
    const file = docxFileInput.files[0];
    docxFileInput.value = '';
    if (!file || !_uploadingId) return;

    const session = await Auth.getSession();
    const btn     = tbody.querySelector(`.docx-upload-btn[data-id="${_uploadingId}"]`);
    if (btn) Utils.setLoading(btn, true);

    try {
      const res = await fetch(`/api/drafting/upload-template?template_id=${encodeURIComponent(_uploadingId)}`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/octet-stream', 'Authorization': `Bearer ${session.access_token}` },
        body: file,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Upload failed (${res.status})`);
      Utils.toast('.docx template uploaded.', 'success');
      await load();
    } catch (err) {
      Utils.toast(err.message || 'Upload failed.', 'error');
      if (btn) Utils.setLoading(btn, false);
    }
    _uploadingId = null;
  });

  await load();

})();
