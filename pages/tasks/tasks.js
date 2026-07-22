// Tasks page logic.
'use strict';

(async function TasksPage() {

  let profile      = await Auth.getProfile();
  let users        = [];
  let clients      = [];
  let filterMine   = false;
  let filterStatus = 'open';
  let filterPriority = '';
  let searchQuery  = '';

  const listEl  = document.getElementById('tasks-list');
  const modalEl = document.getElementById('task-modal');

  // Readable labels for case types shown in the matter dropdown
  const CASE_LABELS = {
    divorce:                  'Divorce',
    custody_modification:     'Custody Modification',
    child_support:            'Child Support',
    child_support_modification: 'Child Support Modification',
    sapcr_original:           'SAPCR – Original',
    sapcr_modification:       'SAPCR – Modification',
    enforcement:              'Enforcement',
    prenuptial_agreement:     'Prenuptial Agreement',
    postnuptial_agreement:    'Postnuptial Agreement',
    adoption:                 'Adoption',
    guardianship:             'Guardianship',
    other:                    'Other',
  };

  function caseLabel(type) { return CASE_LABELS[type] || Utils.titleCase(type); }

  // ── Data loading ─────────────────────────────────────────────────────────────

  async function loadRefs() {
    const [u, c] = await Promise.all([
      db.from('users').select('id,first_name,last_name').eq('active', true).order('first_name'),
      db.from('clients').select('id,first_name,last_name').eq('active', true).order('last_name'),
    ]);
    users   = u.data || [];
    clients = c.data || [];
  }

  async function loadTasks() {
    listEl.innerHTML = `<div class="dk-empty">Loading…</div>`;

    let query = db.from('tasks').select(`
      id, title, description, priority, status, due_date, reminder_at, completed_at, created_at,
      assigned_to, created_by, matter_id, client_id,
      matter:matters(id, case_type, case_number),
      client:clients(id, first_name, last_name)
    `).order('due_date', { ascending: true, nullsFirst: false }).order('priority', { ascending: false });

    if (filterMine && profile?.id) query = query.eq('assigned_to', profile.id);
    if (filterStatus === 'open')   query = query.in('status', ['pending', 'in_progress']);
    else if (filterStatus)         query = query.eq('status', filterStatus);
    if (filterPriority)            query = query.eq('priority', filterPriority);
    if (searchQuery)               query = query.ilike('title', `%${searchQuery}%`);

    const { data, error } = await query.limit(100);
    if (error) { Utils.handleError(error, 'tasks load'); return; }
    renderTasks(data || []);
  }

  // ── Rendering ─────────────────────────────────────────────────────────────────

  // Priority → dk-tag kind (token-driven; dark-safe unlike the old .badge--*)
  const PRIORITY_KIND = { urgent: 'crit', high: 'warn', normal: 'mut', low: 'mut' };

  const deskbarEl = document.getElementById('tasks-deskbar');

  function renderTasks(tasks) {
    if (!tasks.length) {
      if (deskbarEl) deskbarEl.innerHTML = '';
      listEl.innerHTML = `
        <div class="dk-empty" style="text-align:center;padding:36px 20px">
          <p style="font-family:var(--font-serif);font-size:18px;color:var(--ink);margin:0 0 6px">No tasks</p>
          <p style="margin:0 0 16px">Create a task to track work for a matter.</p>
          <button class="btn btn--primary" onclick="document.getElementById('btn-new-task').click()">New task</button>
        </div>`;
      return;
    }

    const GROUP_ORDER = ['Open', 'Completed', 'Cancelled'];
    const GROUP_ID = { Open: 'taskgroup-open', Completed: 'taskgroup-completed', Cancelled: 'taskgroup-cancelled' };
    const grouped = {};
    let overdue = 0;
    const today = new Date().toISOString().slice(0, 10);
    tasks.forEach(t => {
      const g = t.status === 'completed' ? 'Completed' : t.status === 'cancelled' ? 'Cancelled' : 'Open';
      (grouped[g] = grouped[g] || []).push(t);
      if (t.due_date && t.due_date < today && !['completed', 'cancelled'].includes(t.status)) overdue++;
    });

    // At-a-glance desk chips over the loaded set
    if (deskbarEl) {
      const chips = [];
      if (grouped.Open)      chips.push({ n: grouped.Open.length, label: 'Open', jump: GROUP_ID.Open });
      if (overdue)           chips.push({ n: overdue, label: 'Overdue', tone: 'warn' });
      if (grouped.Completed) chips.push({ n: grouped.Completed.length, label: 'Completed', jump: GROUP_ID.Completed });
      deskbarEl.innerHTML = chips.length ? DK.deskbar(chips) : '';
      DK.wireDeskbar(deskbarEl);
    }

    listEl.innerHTML = `<div class="dk-register">` + GROUP_ORDER.filter(g => grouped[g]).map(group => `
      <div class="dk-reg-group" id="${GROUP_ID[group]}">${group} <span class="n">· ${grouped[group].length}</span></div>
      ${grouped[group].map(t => renderTask(t)).join('')}`).join('') + `</div>`;
  }

  function renderTask(t) {
    const assignee   = users.find(u => u.id === t.assigned_to);
    const isOverdue  = t.due_date && t.due_date < new Date().toISOString().slice(0, 10) && !['completed', 'cancelled'].includes(t.status);
    const done       = t.status === 'completed' || t.status === 'cancelled';
    const inProgress = t.status === 'in_progress';

    const tags = [
      DK.tag(Utils.titleCase(t.priority), PRIORITY_KIND[t.priority] || 'mut'),
      inProgress ? DK.tag('In progress', 'acc') : '',
      t.matter ? `<span class="dk-tag mut">${Utils.esc(caseLabel(t.matter.case_type))}${t.matter.case_number ? ' · ' + Utils.esc(t.matter.case_number) : ''}</span>` : '',
    ].filter(Boolean).join('');

    const meta = [
      t.due_date ? `<span class="${isOverdue ? 'danger' : ''}">${isOverdue ? '⚠ ' : ''}Due ${Utils.formatDate(t.due_date)}</span>` : '',
      assignee ? `<span>→ ${Utils.esc(Utils.fullName(assignee))}</span>` : '',
      t.client ? `<span>${Utils.esc(Utils.fullName(t.client))}</span>` : '',
    ].filter(Boolean).join('<span class="sep">·</span>');

    return `<div class="dk-reg-row task-row" data-id="${t.id}" style="grid-template-columns:auto minmax(0,1fr) auto;align-items:start;${done ? 'opacity:.6' : ''}">

      <button class="task-check" data-id="${t.id}" data-status="${t.status}"
              style="margin-top:2px;width:20px;height:20px;padding:0;border:2px solid ${done ? 'var(--color-success)' : inProgress ? 'var(--daily)' : 'var(--line-strong)'};border-radius:5px;flex:none;background:${done ? 'var(--color-success)' : 'transparent'};cursor:pointer;display:grid;place-items:center"
              title="${done ? 'Reopen' : 'Mark complete'}">
        ${done ? '<svg style="width:12px;height:12px" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3"><polyline points="20 6 9 17 4 12"/></svg>' : ''}
      </button>

      <div style="min-width:0">
        <div class="dk-reg-title">
          <span style="${done ? 'text-decoration:line-through;color:var(--ink-faint)' : ''}">${Utils.esc(t.title)}</span>
          ${tags}
        </div>
        ${t.description ? `<div class="dk-reg-meta" style="display:block">${Utils.truncate(Utils.esc(t.description), 120)}</div>` : ''}
        ${meta ? `<div class="dk-reg-meta">${meta}</div>` : ''}
      </div>

      <button class="dk-linkbtn btn-edit-task" data-id="${t.id}" title="Edit task" style="align-self:center">
        <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button>
    </div>`;
  }

  // ── Modal ─────────────────────────────────────────────────────────────────────

  function openModal(taskId = null) {
    modalEl.innerHTML = buildModalHTML(taskId);
    modalEl.classList.remove('hidden');
    document.getElementById('task-title').focus();

    // Wire client → matter cascade
    document.getElementById('task-client').addEventListener('change', e => {
      loadMattersForClient(e.target.value, null);
    });

    if (taskId) loadTaskIntoForm(taskId);

    modalEl.querySelector('.modal-close').addEventListener('click', closeModal);
    modalEl.querySelector('#task-cancel').addEventListener('click', closeModal);
    modalEl.querySelector('#task-form').addEventListener('submit', handleSave);
    modalEl.addEventListener('click', e => { if (e.target === modalEl) closeModal(); });
  }

  function closeModal() { modalEl.classList.add('hidden'); modalEl.innerHTML = ''; }

  function buildModalHTML(taskId) {
    const userOptions   = users.map(u => `<option value="${u.id}">${Utils.fullName(u)}</option>`).join('');
    const clientOptions = clients.map(c => `<option value="${c.id}">${Utils.fullName(c)}</option>`).join('');

    const statusField = taskId ? `
      <div class="field">
        <label for="task-status">Status</label>
        <select id="task-status" name="status">
          <option value="pending">Pending</option>
          <option value="in_progress">In Progress</option>
          <option value="completed">Completed</option>
          <option value="cancelled">Cancelled</option>
        </select>
      </div>` : '';

    return `
    <div class="modal">
      <div class="modal-header">
        <h2 class="modal-title" id="task-modal-title">${taskId ? 'Edit task' : 'New task'}</h2>
        <button class="modal-close" aria-label="Close">×</button>
      </div>
      <form id="task-form" novalidate>
        <div class="modal-body">
          <div class="field">
            <label for="task-title">Task title <span class="required">*</span></label>
            <input type="text" id="task-title" name="title" required placeholder="e.g. Prepare hearing materials">
          </div>
          <div class="field">
            <label for="task-desc">Description</label>
            <textarea id="task-desc" name="description" rows="2"></textarea>
          </div>
          <div class="field-row">
            <div class="field">
              <label for="task-priority">Priority</label>
              <select id="task-priority" name="priority">
                <option value="low">Low</option>
                <option value="normal" selected>Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div class="field">
              <label for="task-due">Due date</label>
              <input type="date" id="task-due" name="due_date">
            </div>
          </div>
          ${statusField}
          <div class="field-row">
            <div class="field">
              <label for="task-assignee">Assign to</label>
              <select id="task-assignee" name="assigned_to">
                <option value="">Unassigned</option>
                ${userOptions}
              </select>
            </div>
            <div class="field">
              <label for="task-client">Client (optional)</label>
              <select id="task-client" name="client_id">
                <option value="">None</option>
                ${clientOptions}
              </select>
            </div>
          </div>
          <div class="field">
            <label for="task-matter">Matter (optional)</label>
            <select id="task-matter" name="matter_id" disabled>
              <option value="">— select a client first —</option>
            </select>
          </div>
          <div class="field">
            <label for="task-reminder">Reminder at (optional)</label>
            <input type="datetime-local" id="task-reminder" name="reminder_at">
          </div>
        </div>
        <div class="modal-footer">
          <div id="task-error" class="form-error hidden" style="flex:1;margin-right:auto"></div>
          <button type="button" class="btn btn--secondary" id="task-cancel">Cancel</button>
          <button type="submit" class="btn btn--primary" id="task-save" data-task-id="${taskId || ''}">${taskId ? 'Save' : 'Create task'}</button>
        </div>
      </form>
    </div>`;
  }

  // Fetch and populate the matter select for a given client.
  // selectedMatterId is pre-selected after load (used when editing).
  async function loadMattersForClient(clientId, selectedMatterId) {
    const sel = document.getElementById('task-matter');
    if (!sel) return;

    if (!clientId) {
      sel.innerHTML = '<option value="">— select a client first —</option>';
      sel.disabled = true;
      return;
    }

    sel.innerHTML = '<option value="">Loading…</option>';
    sel.disabled = true;

    const { data } = await db.from('matters')
      .select('id, case_type, case_number, status')
      .eq('client_id', clientId)
      .order('created_at', { ascending: false });

    const matters = data || [];
    if (!matters.length) {
      sel.innerHTML = '<option value="">No matters on file</option>';
      return;
    }

    sel.innerHTML = '<option value="">None</option>' + matters.map(m => {
      const label = caseLabel(m.case_type) + (m.case_number ? ' · ' + m.case_number : '') + (m.status === 'closed' ? ' (closed)' : '');
      return `<option value="${m.id}" ${m.id === selectedMatterId ? 'selected' : ''}>${Utils.esc(label)}</option>`;
    }).join('');
    sel.disabled = false;
  }

  async function loadTaskIntoForm(taskId) {
    const { data, error } = await db.from('tasks').select('*').eq('id', taskId).single();
    if (error || !data) return;
    const f = document.getElementById('task-form');

    ['title', 'description', 'priority', 'status', 'due_date', 'assigned_to'].forEach(k => {
      const el = f.elements[k];
      if (el && data[k] != null) el.value = data[k];
    });
    if (data.reminder_at) f.elements['reminder_at'].value = data.reminder_at.slice(0, 16);

    // Load matters for the task's client, then select the task's matter
    if (data.client_id) {
      f.elements['client_id'].value = data.client_id;
      await loadMattersForClient(data.client_id, data.matter_id);
    }
  }

  async function handleSave(e) {
    e.preventDefault();
    const errEl   = document.getElementById('task-error');
    const saveBtn = document.getElementById('task-save');
    const taskId  = saveBtn.dataset.taskId;

    errEl.classList.add('hidden');
    Utils.setLoading(saveBtn, true);

    const f       = e.target;
    const profile = await Auth.getProfile();

    const payload = {
      title:       f.elements['title'].value.trim(),
      description: f.elements['description'].value.trim() || null,
      priority:    f.elements['priority'].value,
      due_date:    f.elements['due_date'].value || null,
      assigned_to: f.elements['assigned_to'].value || null,
      client_id:   f.elements['client_id'].value || null,
      matter_id:   f.elements['matter_id'].value || null,
      reminder_at: f.elements['reminder_at'].value ? new Date(f.elements['reminder_at'].value).toISOString() : null,
    };

    // Status only editable on existing tasks
    if (taskId && f.elements['status']) {
      payload.status = f.elements['status'].value;
      if (payload.status === 'completed' && !f.elements['status'].dataset.wasCompleted) {
        payload.completed_at = new Date().toISOString();
      } else if (payload.status !== 'completed') {
        payload.completed_at = null;
      }
    }

    if (!taskId) payload.created_by = profile?.id;

    if (!payload.title) {
      errEl.textContent = 'Task title is required.';
      errEl.classList.remove('hidden');
      Utils.setLoading(saveBtn, false);
      return;
    }

    try {
      let error;
      if (taskId) {
        ({ error } = await db.from('tasks').update(payload).eq('id', taskId));
      } else {
        ({ error } = await db.from('tasks').insert(payload));
      }
      if (error) throw error;
      closeModal();
      Utils.toast(taskId ? 'Task updated.' : 'Task created.', 'success');
      loadTasks();
    } catch (err) {
      errEl.textContent = err.message || 'Save failed.';
      errEl.classList.remove('hidden');
      Utils.setLoading(saveBtn, false);
    }
  }

  async function toggleComplete(taskId, currentStatus) {
    const newStatus = currentStatus === 'completed' ? 'pending' : 'completed';
    const update    = { status: newStatus };
    if (newStatus === 'completed') update.completed_at = new Date().toISOString();
    else update.completed_at = null;

    const { error } = await db.from('tasks').update(update).eq('id', taskId);
    if (error) { Utils.handleError(error, 'toggle task'); return; }
    loadTasks();
  }

  // ── Event wiring ─────────────────────────────────────────────────────────────

  document.getElementById('btn-new-task').addEventListener('click', () => openModal());

  document.getElementById('btn-toggle-mine').addEventListener('click', function () {
    filterMine = !filterMine;
    this.classList.toggle('btn--primary', filterMine);
    this.classList.toggle('btn--secondary', !filterMine);
    document.getElementById('tasks-subtitle').textContent = filterMine
      ? 'The open tasks assigned to you — what you own right now.'
      : "Everything open across the firm — what's due, who owns it, and which matter it moves forward.";
    loadTasks();
  });

  document.getElementById('task-search').addEventListener('input', Utils.debounce(e => {
    searchQuery = e.target.value;
    loadTasks();
  }));

  document.getElementById('filter-task-status').addEventListener('change', e => {
    filterStatus = e.target.value;
    loadTasks();
  });

  document.getElementById('filter-task-priority').addEventListener('change', e => {
    filterPriority = e.target.value;
    loadTasks();
  });

  listEl.addEventListener('click', e => {
    const checkBtn = e.target.closest('.task-check');
    if (checkBtn) { toggleComplete(checkBtn.dataset.id, checkBtn.dataset.status); return; }
    const editBtn = e.target.closest('.btn-edit-task');
    if (editBtn) { openModal(editBtn.dataset.id); return; }
  });

  // ── Init ─────────────────────────────────────────────────────────────────────
  await loadRefs();
  await loadTasks();

})();
