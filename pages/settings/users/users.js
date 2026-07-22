// Settings › Users page logic.
'use strict';

(async function UsersSettingsPage() {

  // Staff-only page — bounce clients back to their portal
  const _profile = await Auth.getProfile();
  if (!_profile || _profile.role?.name === 'Client') {
    window.location.hash = '#client-portal';
    return;
  }

  let roles   = [];
  let users   = [];
  const tbody  = document.getElementById('users-tbody');
  const modalEl = document.getElementById('user-modal');

  async function loadData() {
    const [r, u] = await Promise.all([
      db.from('roles').select('id,name').order('name'),
      db.from('users').select('id,first_name,last_name,email,active,role_id,color,invited_by,invited_at,phone,bar_number,licensing_authority,uscis_account_number,fax,roles(name)').order('last_name'),
    ]);
    roles = (r.data || []).filter(r => r.name !== 'Client');
    users = (u.data || []).filter(u => u.roles?.name !== 'Client');
    renderTable();
  }

  function renderTable() {
    const countEl = document.getElementById('users-count');
    if (countEl) countEl.textContent = users.length ? `${users.length} ${users.length === 1 ? 'person' : 'people'}` : '';

    if (!users.length) {
      tbody.innerHTML = `<div class="dk-empty">No users yet — invite your first team member.</div>`;
      return;
    }
    // People → Docket roster (.dk-att). Keep each row's action classes + data-*
    // so the delegated click handler on #users-tbody still fires.
    const rows = users.map(u => {
      const inviter = users.find(x => x.id === u.invited_by);
      // Custom per-user color is meaningful (attorney color on the client list),
      // so we keep it as the .dk-avatar background instead of DK.avatar's hash hue.
      const avatar = `<span class="dk-avatar" style="width:40px;height:40px;font-size:14px;background:${u.color || 'var(--color-primary)'}">${Utils.initials(u)}</span>`;
      const meta = [
        Utils.esc(u.roles?.name || '—'),
        inviter ? `invited by ${Utils.esc(Utils.fullName(inviter))}` : null,
      ].filter(Boolean).join(' · ');
      return `<div class="dk-att${u.active ? '' : ' warn'}">
        ${avatar}
        <div class="who">
          <b>${Utils.esc(Utils.fullName(u))}</b>
          <div class="slug"><code>${Utils.esc(u.email)}</code> · ${meta}</div>
        </div>
        ${DK.tag(u.active ? 'Active' : 'Inactive', u.active ? 'ok' : 'mut')}
        <div class="dk-reg-act">
          <button class="dk-linkbtn btn-reset-pw-user" data-id="${u.id}" data-email="${Utils.esc(u.email)}" type="button" title="Send password reset email">Reset password</button>
          <button class="dk-linkbtn btn-edit-user" data-id="${u.id}" type="button" title="Edit user">Edit</button>
        </div>
      </div>`;
    }).join('');
    tbody.innerHTML = `<div class="dk-roster">${rows}</div>`;
  }

  function openModal(userId = null) {
    const user = userId ? users.find(u => u.id === userId) : null;
    const roleOptions = roles.map(r => `<option value="${r.id}" ${user?.role_id === r.id ? 'selected' : ''}>${Utils.esc(r.name)}</option>`).join('');

    modalEl.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title" id="user-modal-title">${userId ? 'Edit user' : 'Invite user'}</h2>
        <button class="modal-close" aria-label="Close">×</button>
      </div>
      <form id="user-form" novalidate>
        <div class="modal-body">
          ${!userId ? `<div class="field">
            <label for="user-email">Email address <span class="required">*</span></label>
            <input type="email" id="user-email" name="email" required autocomplete="off">
            <span class="text-muted text-sm">An invite link will be sent to this address.</span>
          </div>` : ''}
          <div class="field-row">
            <div class="field">
              <label for="user-first">First name${!userId ? ' (optional)' : ''}</label>
              <input type="text" id="user-first" name="first_name" value="${Utils.esc(user?.first_name || '')}">
            </div>
            <div class="field">
              <label for="user-last">Last name</label>
              <input type="text" id="user-last" name="last_name" value="${Utils.esc(user?.last_name || '')}">
            </div>
          </div>
          <div class="field">
            <label for="user-role">Role</label>
            <select id="user-role" name="role_id">${roleOptions}</select>
          </div>
          ${userId ? `<div class="field" style="flex-direction:row;align-items:center;gap:var(--space-3)">
            <input type="checkbox" id="user-active" name="active" style="width:auto;cursor:pointer" ${user?.active ? 'checked' : ''}>
            <label for="user-active" style="cursor:pointer;font-weight:400">Active (can sign in)</label>
          </div>
          <div class="field">
            <label for="user-color">Attorney color <span class="text-muted text-sm" style="font-weight:400">(shown next to name on client list)</span></label>
            <div style="display:flex;align-items:center;gap:var(--space-3);flex-wrap:wrap">
              <input type="color" id="user-color" name="color" value="${Utils.esc(user?.color || '#3B82F6')}" style="width:48px;height:36px;padding:2px;border:1px solid var(--color-border);border-radius:var(--radius-md);cursor:pointer">
              <div style="display:flex;gap:var(--space-2)">
                ${['#3B82F6','#10B981','#8B5CF6','#F59E0B','#EF4444','#06B6D4','#F97316','#EC4899'].map(c =>
                  `<button type="button" class="color-swatch" data-color="${c}"
                    style="width:22px;height:22px;border-radius:50%;background:${c};border:2px solid transparent;cursor:pointer;flex-shrink:0"
                    title="${c}"></button>`).join('')}
              </div>
            </div>
          </div>
          <div class="field" style="margin-top:var(--space-2);padding-top:var(--space-3);border-top:1px solid var(--color-border)">
            <label style="font-weight:600">Professional info <span class="text-muted text-sm" style="font-weight:400">(autofilled onto USCIS forms for matters assigned to this attorney)</span></label>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="user-phone">Direct phone</label>
              <input type="tel" id="user-phone" name="phone" value="${Utils.esc(user?.phone || '')}" placeholder="Digits only">
            </div>
            <div class="field">
              <label for="user-fax">Fax</label>
              <input type="tel" id="user-fax" name="fax" value="${Utils.esc(user?.fax || '')}" placeholder="Digits only">
            </div>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="user-bar">Bar number</label>
              <input type="text" id="user-bar" name="bar_number" value="${Utils.esc(user?.bar_number || '')}">
            </div>
            <div class="field">
              <label for="user-uscis-acct">USCIS Online Account #</label>
              <input type="text" id="user-uscis-acct" name="uscis_account_number" value="${Utils.esc(user?.uscis_account_number || '')}" maxlength="12">
            </div>
          </div>
          <div class="field">
            <label for="user-licensing">Licensing authority</label>
            <input type="text" id="user-licensing" name="licensing_authority" value="${Utils.esc(user?.licensing_authority || '')}" placeholder="e.g. State Bar of Texas">
          </div>` : ''}
        </div>
        <div class="modal-footer">
          ${userId ? `
          <button type="button" class="btn btn--ghost btn--sm" id="btn-reset-pw" style="margin-right:var(--space-2)">Reset password</button>
          <button type="button" class="btn btn--ghost btn--sm" id="btn-delete-user" style="color:var(--color-danger)">Delete user</button>
          ` : ''}
          <div id="user-error" class="form-error hidden" style="flex:1;margin:0 var(--space-2)"></div>
          <button type="button" class="btn btn--secondary" id="user-cancel">Cancel</button>
          <button type="submit" class="btn btn--primary" id="user-save" data-user-id="${userId || ''}">${userId ? 'Save changes' : 'Send invite'}</button>
        </div>
      </form>
    </div>`;

    modalEl.classList.remove('hidden');
    (modalEl.querySelector('#user-email') || modalEl.querySelector('#user-first')).focus();
    modalEl.querySelector('.modal-close').addEventListener('click', closeModal);
    modalEl.querySelector('#user-cancel').addEventListener('click', closeModal);
    modalEl.querySelector('#user-form').addEventListener('submit', handleSave);
    modalEl.addEventListener('click', e => { if (e.target === modalEl) closeModal(); });

    // Color swatch quick-picks
    modalEl.querySelectorAll('.color-swatch').forEach(swatch => {
      swatch.addEventListener('click', () => {
        const colorInput = modalEl.querySelector('#user-color');
        if (colorInput) colorInput.value = swatch.dataset.color;
      });
    });

    // Reset password + delete (edit mode only)
    if (userId) {
      const user = users.find(u => u.id === userId);
      modalEl.querySelector('#btn-reset-pw').addEventListener('click', () => handleResetPassword(userId, user?.email));
      modalEl.querySelector('#btn-delete-user').addEventListener('click', () => handleDeleteUser(userId, user));
    }
  }

  async function sendPasswordReset(userId, email) {
    if (!await Utils.confirm(`Send a password reset email to ${email}?`, { confirmLabel: 'Send Reset Email' })) return;
    try {
      const session = await Auth.getSession();
      const res = await fetch('/api/reset-user-password', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body:    JSON.stringify({ user_id: userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      Utils.toast(`Password reset email sent to ${email}.`, 'success');
    } catch (err) {
      Utils.toast(err.message || 'Failed to send reset email.', 'error');
    }
  }

  async function handleResetPassword(userId, email) {
    const btn = modalEl.querySelector('#btn-reset-pw');
    if (btn) { btn.disabled = true; btn.textContent = 'Sending…'; }
    await sendPasswordReset(userId, email);
    if (btn) { btn.disabled = false; btn.textContent = 'Reset password'; }
    closeModal();
  }

  async function handleDeleteUser(userId, user) {
    const name = Utils.fullName(user);
    if (!await Utils.confirm(`Permanently delete ${name}? This cannot be undone.`, { confirmLabel: 'Delete User', danger: true })) return;
    const btn = modalEl.querySelector('#btn-delete-user');
    btn.disabled = true;
    btn.textContent = 'Deleting…';
    try {
      const session = await Auth.getSession();
      const res = await fetch('/api/delete-user', {
        method:  'DELETE',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body:    JSON.stringify({ user_id: userId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      Utils.toast(`${name} has been deleted.`, 'success');
      closeModal();
      loadData();
    } catch (err) {
      Utils.toast(err.message || 'Failed to delete user.', 'error');
      btn.disabled = false;
      btn.textContent = 'Delete user';
    }
  }

  function closeModal() { modalEl.classList.add('hidden'); modalEl.innerHTML = ''; }

  async function handleSave(e) {
    e.preventDefault();
    const errEl   = document.getElementById('user-error');
    const saveBtn = document.getElementById('user-save');
    const userId  = saveBtn.dataset.userId;

    errEl.classList.add('hidden');
    Utils.setLoading(saveBtn, true);
    const f = e.target;

    try {
      if (userId) {
        const colorEl = f.elements['color'];
        const { error } = await db.from('users').update({
          first_name: f.elements['first_name'].value.trim(),
          last_name:  f.elements['last_name'].value.trim(),
          role_id:    f.elements['role_id'].value,
          active:     f.elements['active'].checked,
          color:      colorEl?.value || null,
          phone:                f.elements['phone'].value.trim() || null,
          fax:                  f.elements['fax'].value.trim() || null,
          bar_number:           f.elements['bar_number'].value.trim() || null,
          uscis_account_number: f.elements['uscis_account_number'].value.trim() || null,
          licensing_authority:  f.elements['licensing_authority'].value.trim() || null,
        }).eq('id', userId);
        if (error) throw error;
        Utils.toast('User updated.', 'success');
      } else {
        const email = f.elements['email'].value.trim();
        if (!email) throw new Error('Email is required.');

        const profile = await Auth.getProfile();
        const session = await Auth.getSession();
        const res = await fetch('/api/invite-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
          body: JSON.stringify({
            email,
            first_name: f.elements['first_name'].value.trim() || email.split('@')[0],
            last_name:  f.elements['last_name'].value.trim() || '',
            role_id:    f.elements['role_id'].value,
            invited_by: profile?.id,
          }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error || 'Invite failed.');
        Utils.toast(`Invite sent to ${email}.`, 'success');
      }
      closeModal();
      loadData();
    } catch (err) {
      errEl.textContent = err.message;
      errEl.classList.remove('hidden');
      Utils.setLoading(saveBtn, false);
    }
  }

  document.getElementById('btn-invite-user').addEventListener('click', () => openModal());
  document.getElementById('users-tbody').addEventListener('click', e => {
    const editBtn = e.target.closest('.btn-edit-user');
    if (editBtn) { openModal(editBtn.dataset.id); return; }

    const resetBtn = e.target.closest('.btn-reset-pw-user');
    if (resetBtn) sendPasswordReset(resetBtn.dataset.id, resetBtn.dataset.email);
  });

  await loadData();
})();
