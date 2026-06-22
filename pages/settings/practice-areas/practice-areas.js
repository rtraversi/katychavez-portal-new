'use strict';

(async function PracticeAreasSettings() {

  const grid = document.getElementById('pa-settings-grid');

  // ── Auth — Owner or Partner Attorney ─────────────────────────────────────────
  const profile = await Auth.getProfile();
  const roleName = profile?.role?.name;
  const isOwner  = roleName === 'Owner';
  const canConfigure = isOwner || roleName === 'Partner Attorney';

  if (!canConfigure) {
    grid.innerHTML = '<div class="card" style="padding:var(--space-6);color:var(--color-text-muted)">Only firm owners and partner attorneys can manage practice area settings.</div>';
    return;
  }

  // ── State ─────────────────────────────────────────────────────────────────────
  let practiceAreas   = [];
  let caseTypesData   = [];
  let enabledPaKeys   = new Set();
  let enabledImmKeys  = new Set();

  const IMM_SUBTABS = [
    { key: 'family_based',      label: 'Family-Based Petition & Adjustment' },
    { key: 'employment_based',  label: 'Employment-Based' },
    { key: 'humanitarian',      label: 'Asylum & Humanitarian (DACA, U/T Visa, TPS)' },
    { key: 'removal_defense',   label: 'Removal Defense' },
    { key: 'nonimmigrant',      label: 'Nonimmigrant Visas' },
    { key: 'naturalization',    label: 'Naturalization & Citizenship' },
    { key: 'habeas',            label: 'Habeas Corpus' },
  ];

  // ── Load ──────────────────────────────────────────────────────────────────────
  async function load() {
    const [{ data: pa }, { data: ct }, { data: enabled }, { data: immEnabled }] = await Promise.all([
      db.from('practice_areas').select('*').order('sort_order'),
      db.from('case_types').select('id, practice_area_id').order('sort_order'),
      db.from('enabled_practice_areas').select('practice_area_key'),
      db.from('enabled_immigration_case_types').select('sub_tab_key'),
    ]);
    practiceAreas  = pa  || [];
    caseTypesData  = ct  || [];
    enabledPaKeys  = new Set((enabled    || []).map(r => r.practice_area_key));
    enabledImmKeys = new Set((immEnabled || []).map(r => r.sub_tab_key));
    render();
  }

  // ── Toggle practice area (Owner only) ─────────────────────────────────────────
  async function togglePa(paKey, currentlyEnabled) {
    if (!isOwner) return;
    const btn = grid.querySelector(`[data-toggle="${paKey}"]`);
    if (btn) btn.disabled = true;
    try {
      if (currentlyEnabled) {
        const { error } = await db.from('enabled_practice_areas').delete().eq('practice_area_key', paKey);
        if (error) throw error;
        enabledPaKeys.delete(paKey);
      } else {
        const { error } = await db.from('enabled_practice_areas').insert({ practice_area_key: paKey });
        if (error) throw error;
        enabledPaKeys.add(paKey);
      }
      render();
      Utils.toast(`${currentlyEnabled ? 'Disabled' : 'Enabled'} ${practiceAreas.find(p => p.key === paKey)?.name || paKey}.`, 'success');
    } catch (err) {
      Utils.toast(err.message || 'Save failed.', 'error');
      if (btn) btn.disabled = false;
    }
  }

  // ── Toggle immigration sub-tab (Owner + Partner Attorney) ─────────────────────
  async function toggleImmSubtab(subTabKey, currentlyEnabled) {
    try {
      if (currentlyEnabled) {
        const { error } = await db.from('enabled_immigration_case_types').delete().eq('sub_tab_key', subTabKey);
        if (error) throw error;
        enabledImmKeys.delete(subTabKey);
      } else {
        const { error } = await db.from('enabled_immigration_case_types')
          .insert({ sub_tab_key: subTabKey });
        if (error) throw error;
        enabledImmKeys.add(subTabKey);
      }
      renderImmConfigure();
      const label = IMM_SUBTABS.find(s => s.key === subTabKey)?.label || subTabKey;
      Utils.toast(`${currentlyEnabled ? 'Disabled' : 'Enabled'} ${label}.`, 'success');
    } catch (err) {
      Utils.toast(err.message || 'Save failed.', 'error');
    }
  }

  // ── Render immigration configure panel ────────────────────────────────────────
  function renderImmConfigure() {
    const panel = document.getElementById('imm-configure-panel');
    if (!panel) return;
    panel.innerHTML = `
      <div style="border-top:1px solid var(--color-border);margin-top:var(--space-3);padding-top:var(--space-3)">
        <div style="font-size:var(--text-xs);font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--color-text-muted);margin-bottom:var(--space-3)">Active client-card sub-tabs</div>
        <div style="display:flex;flex-direction:column;gap:var(--space-2)">
          ${IMM_SUBTABS.map(s => {
            const on = enabledImmKeys.has(s.key);
            return `
              <div style="display:flex;align-items:center;justify-content:space-between;gap:var(--space-3)">
                <span style="font-size:var(--text-sm)">${Utils.esc(s.label)}</span>
                <button
                  class="imm-subtab-toggle"
                  data-key="${s.key}"
                  data-enabled="${on}"
                  style="flex-shrink:0;width:40px;height:22px;border-radius:11px;border:none;cursor:pointer;
                         background:${on ? 'var(--color-primary)' : 'var(--color-border)'};
                         position:relative;transition:background .2s">
                  <span style="position:absolute;top:2px;left:${on ? '20px' : '2px'};
                               width:18px;height:18px;border-radius:50%;background:#fff;
                               transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.2)">
                  </span>
                </button>
              </div>`;
          }).join('')}
        </div>
      </div>`;

    panel.querySelectorAll('.imm-subtab-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.key;
        const on  = btn.dataset.enabled === 'true';
        toggleImmSubtab(key, on);
      });
    });
  }

  // ── Render all cards ──────────────────────────────────────────────────────────
  function render() {
    if (!practiceAreas.length) {
      grid.innerHTML = '<div class="card" style="padding:var(--space-6);color:var(--color-text-muted)">No practice areas found.</div>';
      return;
    }

    grid.innerHTML = practiceAreas.map(pa => {
      const isOn    = enabledPaKeys.has(pa.key);
      const ctCount = caseTypesData.filter(ct => ct.practice_area_id === pa.id).length;
      const isImm   = pa.key === 'immigration';

      return `
        <div class="card" style="padding:var(--space-5);display:flex;flex-direction:column;gap:var(--space-3)">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-3)">
            <div>
              <div style="font-weight:600;font-size:var(--text-base);margin-bottom:var(--space-1)">${Utils.esc(pa.name)}</div>
              <div style="font-size:var(--text-sm);color:var(--color-text-muted)">${Utils.esc(pa.description || '')}</div>
            </div>
            ${isOwner ? `
              <button
                class="pa-toggle-btn"
                data-toggle="${Utils.esc(pa.key)}"
                data-enabled="${isOn}"
                aria-label="${isOn ? 'Disable' : 'Enable'} ${Utils.esc(pa.name)}"
                style="flex-shrink:0;width:48px;height:26px;border-radius:13px;border:none;cursor:pointer;
                       background:${isOn ? 'var(--color-primary)' : 'var(--color-border)'};
                       position:relative;transition:background .2s">
                <span style="position:absolute;top:3px;left:${isOn ? '25px' : '3px'};
                             width:20px;height:20px;border-radius:50%;background:#fff;
                             transition:left .2s;box-shadow:0 1px 3px rgba(0,0,0,.2)">
                </span>
              </button>` : ''}
          </div>
          <div style="font-size:var(--text-xs);color:var(--color-text-muted)">
            ${ctCount} case type${ctCount !== 1 ? 's' : ''}
            &nbsp;·&nbsp;
            <span style="font-weight:500;color:${isOn ? 'var(--color-success,#16a34a)' : 'var(--color-text-muted)'}">
              ${isOn ? 'Enabled' : 'Disabled'}
            </span>
          </div>
          ${isImm && isOn ? `<div id="imm-configure-panel"></div>` : ''}
        </div>`;
    }).join('');

    // Wire PA toggle buttons (Owner only)
    if (isOwner) {
      grid.querySelectorAll('.pa-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const key     = btn.dataset.toggle;
          const enabled = btn.dataset.enabled === 'true';
          togglePa(key, enabled);
        });
      });
    }

    // Render immigration configure panel if visible
    if (enabledPaKeys.has('immigration')) {
      renderImmConfigure();
    }
  }

  // ── Init ──────────────────────────────────────────────────────────────────────
  await load();

})();
