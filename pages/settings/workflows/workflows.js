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
      root.innerHTML = '<div class="dk-empty" style="margin-top:var(--space-4)">No practice areas enabled. Enable practice areas in Settings → Practice Areas first.</div>';
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

    const stageRows = stages.map((s, i) => `
      <div class="stage-row dk-reg-row" data-id="${Utils.esc(s.id)}">
        <div>
          <div class="dk-reg-title"><span class="stage-row-dot stage-dot-${s.color}"></span>${Utils.esc(s.name)}${s.is_terminal ? ' ' + DK.tag('Terminal', 'mut') : ''}</div>
          <div class="dk-reg-meta">
            <span>Step ${i + 1} of ${stages.length}</span>
            ${s.is_terminal ? '<span class="sep">·</span><span>Closes the matter</span>' : ''}
          </div>
        </div>
        ${isAdmin ? `<div class="dk-reg-act">
          <button class="dk-linkbtn stage-up-btn" data-idx="${i}" type="button" title="Move up" ${i === 0 ? 'disabled' : ''}>↑</button>
          <button class="dk-linkbtn stage-down-btn" data-idx="${i}" type="button" title="Move down" ${i === stages.length - 1 ? 'disabled' : ''}>↓</button>
          <button class="dk-linkbtn stage-terminal-btn" data-id="${Utils.esc(s.id)}" data-terminal="${s.is_terminal}" type="button" title="${s.is_terminal ? 'Unmark terminal' : 'Mark as terminal (case closed)'}">${s.is_terminal ? '⚑' : '⚐'}</button>
          <button class="dk-linkbtn d stage-delete-btn" data-id="${Utils.esc(s.id)}" data-name="${Utils.esc(s.name)}" type="button" title="Delete stage">✕</button>
        </div>` : ''}
      </div>`).join('');

    const stageBlock = stages.length
      ? `<div class="dk-register">${stageRows}</div>`
      : '<div class="dk-empty">No stages defined yet. Add your first stage below.</div>';

    const addForm = isAdmin ? `
      <div class="add-stage-form" id="add-stage-form">
        <div class="field field-stack" style="flex:1;min-width:240px">
          <label class="field-label" for="new-stage-name">Stage name</label>
          <input class="field-input" id="new-stage-name" placeholder="e.g. Documents Pending">
        </div>
        <div class="field field-stack">
          <label class="field-label">Color</label>
          <div class="color-swatch-row" id="color-swatches">
            ${COLORS.map(c => `<span class="color-swatch${c === 'blue' ? ' selected' : ''}" data-color="${c}" style="background:${COLOR_HEX[c]}" title="${c}"></span>`).join('')}
          </div>
        </div>
        <div style="display:inline-flex;align-items:center;gap:9px;padding-bottom:8px">
          <span class="dk-toggle"><input type="checkbox" id="new-stage-terminal"><span class="dk-toggle-track"></span></span>
          <label for="new-stage-terminal" style="font-size:var(--text-sm);color:var(--color-text);cursor:pointer;margin:0">Terminal stage (case complete)</label>
        </div>
        <button class="btn btn--primary" id="btn-add-stage" type="button">Add stage</button>
      </div>` : '';

    root.innerHTML = `
      <div class="wf-pa-tabs" id="wf-pa-tabs">${tabs}</div>
      <div class="dk-sec" style="margin-bottom:0">
        ${DK.sectionHead('Pipeline stages')}
        <div id="stage-list">${stageBlock}</div>
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
