// Settings › Permissions matrix page.
'use strict';

(async function PermissionsPage() {

  const wrap = document.getElementById('permissions-wrap');
  let roles   = [];
  let modules = [];
  let matrix  = {};  // {role_id: {module_key: access_level}}
  let dirty   = {};  // pending changes

  const profile  = await Auth.getProfile();
  const canEdit  = ['Owner', 'Partner Attorney'].includes(profile?.role?.name);

  async function loadData() {
    const [r, m, a] = await Promise.all([
      db.from('roles').select('id,name,is_system_role').order('name'),
      db.from('modules').select('key,name,wave').order('sort_order'),
      db.from('role_module_access').select('role_id,module_key,access_level'),
    ]);
    roles   = r.data || [];
    modules = m.data || [];

    (a.data || []).forEach(row => {
      (matrix[row.role_id] = matrix[row.role_id] || {})[row.module_key] = row.access_level;
    });

    render();
  }

  function getLevel(roleId, moduleKey) {
    return (dirty[roleId]?.[moduleKey]) ?? (matrix[roleId]?.[moduleKey]) ?? 'none';
  }

  function render() {
    const nonOwnerRoles = roles.filter(r => r.name !== 'Owner');

    const thead = `<thead><tr>
      <th style="min-width:180px">Module</th>
      ${nonOwnerRoles.map(r => `<th style="text-align:center;min-width:110px">${Utils.esc(r.name)}</th>`).join('')}
    </tr></thead>`;

    const LEVELS = ['none', 'read', 'write', 'admin'];
    const LABELS = { none: '—', read: 'Read', write: 'Write', admin: 'Admin' };

    const byWave = {};
    modules.forEach(m => (byWave[m.wave] = byWave[m.wave] || []).push(m));

    // The access matrix is inherently a 2-D role × module grid with 4-level
    // access cells (none/read/write/admin) — the Docket kit has no component
    // for that, so we keep it as a table. Each wave becomes its own ruled
    // section head (DK.sectionHead), with the grid preserved underneath.
    const sections = Object.entries(byWave).map(([wave, mods]) => {
      const modRows = mods.map(mod => {
        const cells = nonOwnerRoles.map(role => {
          const current = getLevel(role.id, mod.key);
          const options = LEVELS.map(l => `<option value="${l}" ${current === l ? 'selected' : ''}>${LABELS[l]}</option>`).join('');
          return `<td style="text-align:center">
            <select class="perm-select" style="width:90px;font-size:var(--text-xs);padding:4px 8px;text-align:center"
                    data-role="${role.id}" data-module="${mod.key}"${canEdit ? '' : ' disabled'}>
              ${options}
            </select>
          </td>`;
        }).join('');
        return `<tr>
          <td style="padding:var(--space-3) var(--space-4)">
            <span style="font-weight:500">${Utils.esc(mod.name)}</span>
            <span class="text-muted text-sm" style="margin-left:var(--space-2)">(${mod.key})</span>
          </td>
          ${cells}
        </tr>`;
      }).join('');
      return `<div class="dk-sec">
        ${DK.sectionHead(`Wave ${wave}`, { count: mods.length })}
        <div class="table-wrap">
          <table aria-label="Permissions matrix — Wave ${Utils.esc(wave)}">${thead}<tbody>${modRows}</tbody></table>
        </div>
      </div>`;
    }).join('');

    wrap.innerHTML = sections;

    if (!canEdit) {
      const saveBtn = document.getElementById('btn-save-permissions');
      if (saveBtn) saveBtn.style.display = 'none';
      const notice = document.createElement('p');
      notice.style.cssText = 'font-size:var(--text-sm);color:var(--color-text-muted);margin-top:var(--space-4)';
      notice.textContent = 'You have read-only access to the permissions matrix. Contact an Owner or Partner Attorney to make changes.';
      wrap.after(notice);
      return;
    }

    wrap.querySelectorAll('.perm-select').forEach(sel => {
      sel.addEventListener('change', e => {
        const { role, module: mod } = e.target.dataset;
        (dirty[role] = dirty[role] || {})[mod] = e.target.value;
        e.target.style.background = '#fef9c3';
      });
    });
  }

  document.getElementById('btn-save-permissions').addEventListener('click', async () => {
    const btn = document.getElementById('btn-save-permissions');
    if (!Object.keys(dirty).length) { Utils.toast('No changes to save.', 'info'); return; }
    Utils.setLoading(btn, true);

    const upserts = [];
    Object.entries(dirty).forEach(([roleId, mods]) => {
      Object.entries(mods).forEach(([moduleKey, level]) => {
        upserts.push({ role_id: roleId, module_key: moduleKey, access_level: level });
      });
    });

    const { error } = await db.from('role_module_access').upsert(upserts, { onConflict: 'role_id,module_key' });
    if (error) {
      Utils.handleError(error, 'save permissions');
      Utils.setLoading(btn, false);
      return;
    }

    upserts.forEach(u => (matrix[u.role_id] = matrix[u.role_id] || {})[u.module_key] = u.access_level);
    dirty = {};
    wrap.querySelectorAll('.perm-select').forEach(s => s.style.background = '');
    Utils.toast('Permissions saved.', 'success');
    Utils.setLoading(btn, false);
  });

  await loadData();
})();
