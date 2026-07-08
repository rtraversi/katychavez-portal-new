'use strict';

(async function WorkflowsPage() {
  const root    = document.getElementById('workflows-root');
  const profile = await Auth.getProfile();
  const canEdit = ['Owner', 'Partner Attorney', 'Attorney', 'Paralegal', 'Staff'].includes(profile?.role?.name);
  const isAdmin = ['Owner', 'Partner Attorney'].includes(profile?.role?.name);

  const COLORS = ['gray','blue','yellow','orange','green','red'];
  const COLOR_HEX = { gray:'#94a3b8', blue:'#3b82f6', yellow:'#f59e0b', orange:'#f97316', green:'#22c55e', red:'#ef4444' };

  let activePa   = null;
  let stages     = [];    // workflow_stages for active PA
  let enabledPAs = [];    // enabled practice areas for this firm

  async function load() {
    const [{ data: allPas }, { data: enabledKeys }] = await Promise.all([
      db.from('practice_areas').select('key, name').order('sort_order'),
      db.from('enabled_practice_areas').select('practice_area_key'),
    ]);
    const enabledSet = new Set((enabledKeys || []).map(r => r.practice_area_key));
    enabledPAs = (allPas || []).filter(p => enabledSet.has(p.key));
    if (!enabledPAs.length) {
      root.innerHTML = '<p class="text-muted" style="padding:var(--space-4) 0">No practice areas enabled. Enable practice areas in Settings → Practice Areas first.</p>';
      return;
    }
    if (!activePa) activePa = enabledPAs[0].key;
    await loadStages();
    render();
  }

  async function loadStages() {
    const { data } = await db
      .from('workflow_stages')
      .select('id, name, color, order_index, is_terminal')
      .eq('practice_area', activePa)
      .order('order_index');
    stages = data || [];
  }

  function render() {
    const tabs = enabledPAs.map(pa =>
      `<button class="wf-pa-tab${pa.key === activePa ? ' wf-pa-tab--active' : ''}" data-pa="${Utils.esc(pa.key)}">${Utils.esc(pa.name)}</button>`
    ).join('');

    const stageRows = stages.length
      ? stages.map((s, i) => `
          <div class="stage-row" data-id="${Utils.esc(s.id)}">
            <span class="stage-row-drag">⠿</span>
            <span class="stage-row-dot stage-dot-${s.color}"></span>
            <span class="stage-row-name">${Utils.esc(s.name)}</span>
            ${s.is_terminal ? '<span class="stage-row-terminal badge badge--inactive">Terminal</span>' : ''}
            ${isAdmin ? `<div class="stage-row-actions">
              <button class="btn btn--ghost btn--sm stage-up-btn" data-idx="${i}" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
              <button class="btn btn--ghost btn--sm stage-down-btn" data-idx="${i}" title="Move down" ${i === stages.length - 1 ? 'disabled' : ''}>↓</button>
              <button class="btn btn--ghost btn--sm stage-terminal-btn" data-id="${Utils.esc(s.id)}" data-terminal="${s.is_terminal}" title="${s.is_terminal ? 'Unmark terminal' : 'Mark as terminal (case closed)'}">${s.is_terminal ? '⚑' : '⚐'}</button>
              <button class="btn btn--ghost btn--sm stage-delete-btn" data-id="${Utils.esc(s.id)}" data-name="${Utils.esc(s.name)}" style="color:var(--color-danger)">✕</button>
            </div>` : ''}
          </div>`)
        .join('')
      : '<p style="color:var(--color-text-muted);font-size:var(--text-sm);padding:var(--space-3) 0">No stages defined yet. Add your first stage below.</p>';

    const addForm = isAdmin ? `
      <div class="add-stage-form" id="add-stage-form">
        <div>
          <label>Stage Name</label>
          <input class="input" id="new-stage-name" placeholder="e.g. Documents Pending" style="width:240px">
        </div>
        <div>
          <label>Color</label>
          <div class="color-swatch-row" id="color-swatches">
            ${COLORS.map(c => `<span class="color-swatch${c === 'blue' ? ' selected' : ''}" data-color="${c}" style="background:${COLOR_HEX[c]}" title="${c}"></span>`).join('')}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:var(--space-2);padding-bottom:2px">
          <input type="checkbox" id="new-stage-terminal" style="width:auto">
          <label for="new-stage-terminal" style="text-transform:none;letter-spacing:0;font-size:var(--text-sm);font-weight:400;color:var(--color-text)">Terminal stage (case complete)</label>
        </div>
        <button class="btn btn--primary btn--sm" id="btn-add-stage" style="margin-bottom:1px">Add Stage</button>
      </div>` : '';

    root.innerHTML = `
      <div class="detail-section">
        <div class="wf-pa-tabs" id="wf-pa-tabs">${tabs}</div>
        <div class="stage-list" id="stage-list">${stageRows}</div>
        ${addForm}
      </div>`;

    wireEvents();
  }

  function wireEvents() {
    document.getElementById('wf-pa-tabs')?.querySelectorAll('.wf-pa-tab').forEach(btn => {
      btn.addEventListener('click', async () => {
        activePa = btn.dataset.pa;
        await loadStages();
        render();
      });
    });

    // Color picker
    let selectedColor = 'blue';
    document.getElementById('color-swatches')?.querySelectorAll('.color-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        document.querySelectorAll('.color-swatch').forEach(s => s.classList.remove('selected'));
        sw.classList.add('selected');
        selectedColor = sw.dataset.color;
      });
    });

    // Add stage
    document.getElementById('btn-add-stage')?.addEventListener('click', async () => {
      const name = document.getElementById('new-stage-name')?.value.trim();
      if (!name) { Utils.toast('Enter a stage name.', 'error'); return; }
      const isTerminal = document.getElementById('new-stage-terminal')?.checked || false;
      const maxOrder = stages.length ? Math.max(...stages.map(s => s.order_index)) : -1;

      const { error } = await db.from('workflow_stages').insert({
        practice_area: activePa,
        name,
        color:         selectedColor,
        order_index:   maxOrder + 1,
        is_terminal:   isTerminal,
        created_by:    profile.id,
      });

      if (error) { Utils.toast('Failed to add stage: ' + error.message, 'error'); return; }
      Utils.toast(`Stage "${name}" added.`, 'success');
      await loadStages();
      render();
    });

    // Move up / down
    document.getElementById('stage-list')?.querySelectorAll('.stage-up-btn').forEach(btn => {
      btn.addEventListener('click', () => reorder(Number(btn.dataset.idx), -1));
    });
    document.getElementById('stage-list')?.querySelectorAll('.stage-down-btn').forEach(btn => {
      btn.addEventListener('click', () => reorder(Number(btn.dataset.idx), 1));
    });

    // Toggle terminal
    document.getElementById('stage-list')?.querySelectorAll('.stage-terminal-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const newVal = btn.dataset.terminal !== 'true';
        await db.from('workflow_stages').update({ is_terminal: newVal }).eq('id', btn.dataset.id);
        await loadStages(); render();
      });
    });

    // Delete
    document.getElementById('stage-list')?.querySelectorAll('.stage-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!await Utils.confirm(`Delete stage "${btn.dataset.name}"? Matters currently at this stage will have their stage cleared.`, { confirmLabel: 'Delete Stage', danger: true })) return;
        const { error } = await db.from('workflow_stages').delete().eq('id', btn.dataset.id);
        if (error) { Utils.toast('Failed to delete: ' + error.message, 'error'); return; }
        Utils.toast('Stage deleted.', 'success');
        await loadStages(); render();
      });
    });
  }

  async function reorder(idx, dir) {
    const swapIdx = idx + dir;
    if (swapIdx < 0 || swapIdx >= stages.length) return;

    const a = stages[idx];
    const b = stages[swapIdx];

    await Promise.all([
      db.from('workflow_stages').update({ order_index: b.order_index }).eq('id', a.id),
      db.from('workflow_stages').update({ order_index: a.order_index }).eq('id', b.id),
    ]);

    await loadStages(); render();
  }

  await load();
})();
