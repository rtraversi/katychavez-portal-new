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
      render();  // resync the slider to the actual saved state
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
      render();  // refresh the "x/y sub-tabs on" count on the parent row
      const label = IMM_SUBTABS.find(s => s.key === subTabKey)?.label || subTabKey;
      Utils.toast(`${currentlyEnabled ? 'Disabled' : 'Enabled'} ${label}.`, 'success');
    } catch (err) {
      Utils.toast(err.message || 'Save failed.', 'error');
      render();  // resync the slider to the actual saved state
    }
  }

  const CHEVRON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>';

  // Sub-areas nested under a practice area. Only Immigration is populated today;
  // every other area returns null (no sub-areas → nothing shows). As new areas
  // gain gated sub-areas, add a branch here and they plug into the same UI.
  function subAreasFor(pa) {
    if (pa.key === 'immigration') {
      return IMM_SUBTABS.map(s => ({ key: s.key, label: s.label, on: enabledImmKeys.has(s.key) }));
    }
    return null;
  }

  // ── Render (Docket kit: register of practice areas, sub-areas nested under) ────
  function render() {
    if (!practiceAreas.length) {
      grid.innerHTML = '<div class="dk-empty">No practice areas found.</div>';
      return;
    }

    const items = practiceAreas.map(pa => {
      const isOn    = enabledPaKeys.has(pa.key);
      const ctCount = caseTypesData.filter(ct => ct.practice_area_id === pa.id).length;
      const subs    = isOn ? subAreasFor(pa) : null;   // sub-areas only when the area is on
      const hasSubs = !!(subs && subs.length);
      const control = isOwner
        ? DK.toggle(`data-toggle="${Utils.esc(pa.key)}" aria-label="${isOn ? 'Disable' : 'Enable'} ${Utils.esc(pa.name)}"`, isOn)
        : DK.tag(isOn ? 'Enabled' : 'Disabled', isOn ? 'ok' : 'mut');
      const disclosure = hasSubs
        ? `<button class="dk-disclosure" data-expand="${Utils.esc(pa.key)}" aria-expanded="true" aria-label="Show ${Utils.esc(pa.name)} sub-areas">${CHEVRON}</button>`
        : '';

      const row = `<div class="dk-reg-row">
        <div>
          <div class="dk-reg-title">${Utils.esc(pa.name)} ${isOwner && isOn ? DK.tag('Enabled', 'ok') : ''}</div>
          <div class="dk-reg-meta">
            ${pa.description ? `<span>${Utils.esc(pa.description)}</span><span class="sep">·</span>` : ''}
            <span>${ctCount} case type${ctCount !== 1 ? 's' : ''}</span>
            ${hasSubs ? `<span class="sep">·</span><span>${subs.filter(s => s.on).length}/${subs.length} sub-tabs on</span>` : ''}
          </div>
        </div>
        <div class="dk-reg-act">${disclosure}${control}</div>
      </div>`;

      const panel = hasSubs ? `<div class="dk-subrows" id="sub-${Utils.esc(pa.key)}">
        <div class="dk-subrows-head">Sub-tabs shown on the client card</div>
        ${subs.map(s => `<div class="dk-subrow"><span>${Utils.esc(s.label)}</span>${DK.toggle(`data-imm-key="${Utils.esc(s.key)}"`, s.on)}</div>`).join('')}
      </div>` : '';

      return row + panel;
    }).join('');

    grid.innerHTML = `<div class="dk-sec" style="margin-bottom:0">
      ${DK.sectionHead('Practice areas')}
      <div class="dk-register">${items}</div>
    </div>`;

    // Wire PA on/off toggles (Owner only)
    if (isOwner) {
      grid.querySelectorAll('[data-toggle]').forEach(cb => {
        cb.addEventListener('change', () => togglePa(cb.dataset.toggle, !cb.checked));
      });
    }
    // Wire sub-area toggles (immigration sub-tabs today)
    grid.querySelectorAll('[data-imm-key]').forEach(cb => {
      cb.addEventListener('change', () => toggleImmSubtab(cb.dataset.immKey, !cb.checked));
    });
    // Wire disclosure chevrons (expand/collapse the nested sub-areas)
    grid.querySelectorAll('.dk-disclosure').forEach(btn => {
      btn.addEventListener('click', () => {
        const panel = document.getElementById(`sub-${btn.dataset.expand}`);
        if (!panel) return;
        const open = btn.getAttribute('aria-expanded') === 'true';
        btn.setAttribute('aria-expanded', String(!open));
        panel.classList.toggle('collapsed', open);
      });
    });
  }

  // ── Init ──────────────────────────────────────────────────────────────────────
  await load();

})();
