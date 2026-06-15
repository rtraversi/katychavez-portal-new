// Settings › Permissions matrix page.
'use strict';

(async function PermissionsPage() {

  const wrap = document.getElementById('permissions-wrap');
  let roles   = [];
  let modules = [];
  let matrix  = {};  // {role_id: {module_key: access_level}}
  let dirty   = {};  // pending changes

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

    const rows = Object.entries(byWave).map(([wave, mods]) => {
      const header = `<tr><td colspan="${nonOwnerRoles.length + 1}" style="background:var(--color-bg);padding:var(--space-3) var(--space-4);font-size:var(--text-xs);font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--color-text-muted)">Wave ${wave}</td></tr>`;
      const modRows = mods.map(mod => {
        const cells = nonOwnerRoles.map(role => {
          const current = getLevel(role.id, mod.key);
          const options = LEVELS.map(l => `<option value="${l}" ${current === l ? 'selected' : ''}>${LABELS[l]}</option>`).join('');
          return `<td style="text-align:center">
            <select class="perm-select" style="width:90px;font-size:var(--text-xs);padding:4px 8px;text-align:center"
                    data-role="${role.id}" data-module="${mod.key}">
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
      return header + modRows;
    }).join('');

    wrap.innerHTML = `<table aria-label="Permissions matrix"><${thead}<tbody>${rows}</tbody></table>`;

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
