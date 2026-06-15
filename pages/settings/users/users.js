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
      db.from('users').select('id,first_name,last_name,email,active,role_id,color,invited_by,invited_at,roles(name)').order('last_name'),
    ]);
    roles = (r.data || []).filter(r => r.name !== 'Client');
    users = (u.data || []).filter(u => u.roles?.name !== 'Client');
    renderTable();
  }

  function renderTable() {
    if (!users.length) {
      tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p class="empty-state-title">No users yet</p><p>Invite your first team member.</p></div></td></tr>`;
      return;
    }
    tbody.innerHTML = users.map(u => {
      const inviter = users.find(x => x.id === u.invited_by);
      return `<tr>
        <td>
          <div style="display:flex;align-items:center;gap:var(--space-3)">
            <div style="width:32px;height:32px;border-radius:50%;background:${u.color || 'var(--color-primary)'};color:#fff;display:grid;place-items:center;font-size:var(--text-xs);font-weight:600;flex-shrink:0">${Utils.initials(u)}</div>
            <span style="font-weight:500">${Utils.esc(Utils.fullName(u))}</span>
          </div>
        </td>
        <td>${Utils.esc(u.email)}</td>
        <td>${Utils.esc(u.roles?.name || '—')}</td>
        <td><span class="badge badge--${u.active ? 'active' : 'closed'}">${u.active ? 'Active' : 'Inactive'}</span></td>
        <td class="text-muted text-sm">${inviter ? Utils.fullName(inviter) : '—'}</td>
        <td>
          <button class="btn btn--ghost btn--sm btn-edit-user" data-id="${u.id}" title="Edit user">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
        </td>
      </tr>`;
    }).join('');
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

  async function handleResetPassword(userId, email) {
    if (!await Utils.confirm(`Send a password reset email to ${email}?`, { confirmLabel: 'Send Reset Email' })) return;
    const btn = modalEl.querySelector('#btn-reset-pw');
    btn.disabled = true;
    btn.textContent = 'Sending…';
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
      closeModal();
    } catch (err) {
      Utils.toast(err.message || 'Failed to send reset email.', 'error');
      btn.disabled = false;
      btn.textContent = 'Reset password';
    }
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
    const btn = e.target.closest('.btn-edit-user');
    if (btn) openModal(btn.dataset.id);
  });

  await loadData();
})();
