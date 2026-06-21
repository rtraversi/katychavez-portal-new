'use strict';

(async function PracticeAreasSettings() {

  const grid = document.getElementById('pa-settings-grid');

  // ── Auth — Owner only ─────────────────────────────────────────────────────────
  const profile = await Auth.getProfile();
  if (profile?.role?.name !== 'Owner') {
    grid.innerHTML = '<div class="card" style="padding:var(--space-6);color:var(--color-text-muted)">Only firm owners can manage practice areas.</div>';
    return;
  }

  // ── Load ──────────────────────────────────────────────────────────────────────
  let practiceAreas = [];
  let caseTypesData = [];
  let enabledKeys   = new Set();

  async function load() {
    const [{ data: pa }, { data: ct }, { data: enabled }] = await Promise.all([
      db.from('practice_areas').select('*').order('sort_order'),
      db.from('case_types').select('id, practice_area_id').order('sort_order'),
      db.from('enabled_practice_areas').select('practice_area_key'),
    ]);
    practiceAreas = pa || [];
    caseTypesData = ct || [];
    enabledKeys   = new Set((enabled || []).map(r => r.practice_area_key));
    render();
  }

  // ── Toggle ────────────────────────────────────────────────────────────────────
  async function toggle(paKey, currentlyEnabled) {
    const btn = grid.querySelector(`[data-toggle="${paKey}"]`);
    if (btn) btn.disabled = true;

    try {
      if (currentlyEnabled) {
        const { error } = await db.from('enabled_practice_areas').delete().eq('practice_area_key', paKey);
        if (error) throw error;
        enabledKeys.delete(paKey);
      } else {
        const { error } = await db.from('enabled_practice_areas').insert({ practice_area_key: paKey });
        if (error) throw error;
        enabledKeys.add(paKey);
      }
      render();
      Utils.toast(`${currentlyEnabled ? 'Disabled' : 'Enabled'} ${practiceAreas.find(p => p.key === paKey)?.name || paKey}.`, 'success');
    } catch (err) {
      Utils.toast(err.message || 'Save failed.', 'error');
      if (btn) btn.disabled = false;
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  function render() {
    if (!practiceAreas.length) {
      grid.innerHTML = '<div class="card" style="padding:var(--space-6);color:var(--color-text-muted)">No practice areas found.</div>';
      return;
    }

    grid.innerHTML = practiceAreas.map(pa => {
      const isOn    = enabledKeys.has(pa.key);
      const ctCount = caseTypesData.filter(ct => ct.practice_area_id === pa.id).length;

      return `
        <div class="card" style="padding:var(--space-5);display:flex;flex-direction:column;gap:var(--space-3)">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:var(--space-3)">
            <div>
              <div style="font-weight:600;font-size:var(--text-base);margin-bottom:var(--space-1)">${Utils.esc(pa.name)}</div>
              <div style="font-size:var(--text-sm);color:var(--color-text-muted)">${Utils.esc(pa.description || '')}</div>
            </div>
            <!-- Toggle switch -->
            <button
              class="pa-toggle-btn"
              data-toggle="${Utils.esc(pa.key)}"
              data-enabled="${isOn}"
              aria-label="${isOn ? 'Disable' : 'Enable'} ${Utils.esc(pa.name)}"
              style="flex-shrink:0;width:48px;height:26px;border-radius:13px;border:none;cursor:pointer;
                     background:${isOn ? 'var(--color-primary)' : 'var(--color-border)'};
                     position:relative;transition:background .2s">
              <span style="
                position:absolute;top:3px;
                left:${isOn ? '25px' : '3px'};
                width:20px;height:20px;border-radius:50%;
                background:#fff;transition:left .2s;
                box-shadow:0 1px 3px rgba(0,0,0,.2)">
              </span>
            </button>
          </div>
          <div style="font-size:var(--text-xs);color:var(--color-text-muted)">
            ${ctCount} case type${ctCount !== 1 ? 's' : ''}
            &nbsp;·&nbsp;
            <span style="font-weight:500;color:${isOn ? 'var(--color-success,#16a34a)' : 'var(--color-text-muted)'}">
              ${isOn ? 'Enabled' : 'Disabled'}
            </span>
          </div>
        </div>`;
    }).join('');

    // Wire toggle buttons
    grid.querySelectorAll('.pa-toggle-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key     = btn.dataset.toggle;
        const enabled = btn.dataset.enabled === 'true';
        toggle(key, enabled);
      });
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────────
  await load();

})();
