document.addEventListener('DOMContentLoaded', () => {
  const form = document.getElementById('taskComposer');
  const prompt = document.getElementById('taskPrompt');
  const filesInput = document.getElementById('taskFiles');
  const selectedFiles = document.getElementById('selectedFiles');
  const taskMode = document.getElementById('taskMode');
  const skillPicker = document.getElementById('taskSkillPicker');
  const skillInputs = [...document.querySelectorAll('input[name="task_skill"]')];
  const skillLimit = Number(skillPicker?.dataset.limit || 3);
  let inheritedSkills = new Set();
  const selectedSkillIds = () => skillInputs.filter(input => input.checked).map(input => input.value);
  const updateSkillPicker = () => {
    const count = selectedSkillIds().length;
    const counter = document.getElementById('selectedSkillCount');
    if (counter) counter.textContent = String(count);
    skillPicker?.classList.toggle('has-selection', count > 0);
  };
  const applyProjectSkills = () => {
    const select = document.getElementById('taskProject');
    let defaults = [];
    try { defaults = JSON.parse(select?.selectedOptions?.[0]?.dataset.skills || '[]'); } catch {}
    const nextInherited = new Set(defaults);
    skillInputs.forEach(input => {
      const wasInherited = inheritedSkills.has(input.value);
      const isInherited = nextInherited.has(input.value);
      if (wasInherited && !isInherited) input.checked = false;
      if (isInherited) input.checked = true;
      input.disabled = isInherited;
      input.closest('label')?.classList.toggle('inherited', isInherited);
      input.closest('label')?.setAttribute('title', isInherited ? 'Skill predefinita dal progetto' : '');
    });
    inheritedSkills = nextInherited;
    updateSkillPicker();
  };
  skillInputs.forEach(input => input.addEventListener('change', () => {
    if (selectedSkillIds().length > skillLimit) {
      input.checked = false;
      showToast(`Puoi selezionare al massimo ${skillLimit} Skills per task.`, 'error');
    }
    updateSkillPicker();
  }));
  document.getElementById('taskProject')?.addEventListener('change', applyProjectSkills);
  applyProjectSkills();
  const setTaskMode = (mode) => {
    const selected = mode === 'team' ? 'team' : 'autonomous';
    if (taskMode) taskMode.value = selected;
    document.querySelectorAll('[data-task-mode]').forEach(button => {
      const active = button.dataset.taskMode === selected;
      button.classList.toggle('active', active);
      button.setAttribute('aria-pressed', String(active));
    });
  };
  document.querySelectorAll('[data-task-mode]').forEach(button => button.addEventListener('click', () => setTaskMode(button.dataset.taskMode)));
  document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => {
    prompt.value = button.dataset.prompt;
    if (button.dataset.mode) setTaskMode(button.dataset.mode);
    prompt.focus();
  }));
  document.getElementById('attachFiles')?.addEventListener('click', () => filesInput.click());
  filesInput?.addEventListener('change', () => {
    const files = [...filesInput.files];
    selectedFiles.classList.toggle('hidden', files.length === 0);
    selectedFiles.replaceChildren(...files.map(file => {
      const chip = document.createElement('span');
      chip.textContent = `${file.name} · ${Math.ceil(file.size / 1024)} KB`;
      return chip;
    }));
  });
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i><span>Creo il piano…</span>';
    const body = new FormData();
    body.append('prompt', prompt.value);
    body.append('project_id', document.getElementById('taskProject')?.value || '');
    body.append('mode', taskMode?.value || 'autonomous');
    body.append('skill_ids', JSON.stringify(selectedSkillIds()));
    [...(filesInput?.files || [])].forEach(file => body.append('files', file));
    try {
      const response = await fetch('/api/tasks', { method: 'POST', body, credentials: 'same-origin', headers: { Accept: 'application/json' } });
      const result = await response.json();
      if (response.ok && result.success) window.location.href = result.redirect;
      else throw new Error(result.error || 'Impossibile creare il task');
    } catch (error) {
      showToast(error.message, 'error');
      button.disabled = false;
      button.innerHTML = '<span>Avvia WES</span><i class="fas fa-arrow-up"></i>';
    }
  });
  document.getElementById('stopTask')?.addEventListener('click', async function () {
    if (!confirm('Vuoi interrompere questo task?')) return;
    const result = await apiCall(`/api/tasks/${this.dataset.id}/stop`, 'POST');
    if (result.success) location.reload();
  });
  document.getElementById('retryTask')?.addEventListener('click', async function () {
    this.disabled = true;
    const result = await apiCall(`/api/tasks/${this.dataset.id}/retry`, 'POST');
    if (result.success) location.reload();
    else { showToast(result.error || 'Impossibile riavviare', 'error'); this.disabled = false; }
  });
  document.querySelectorAll('[data-approval]').forEach(button => button.addEventListener('click', async function () {
    const decision = this.dataset.decision;
    if (decision === 'approved' && !confirm('Confermi espressamente questa azione?')) return;
    const result = await apiCall(`/api/approvals/${this.dataset.approval}`, 'POST', { decision });
    if (result.success) location.reload();
    else showToast(result.error || 'Decisione non salvata', 'error');
  }));

  const modal = document.getElementById('projectModal');
  document.getElementById('openProjectModal')?.addEventListener('click', () => modal.classList.remove('hidden'));
  document.getElementById('closeProjectModal')?.addEventListener('click', () => modal.classList.add('hidden'));
  modal?.addEventListener('click', event => { if (event.target === modal) modal.classList.add('hidden'); });
  document.getElementById('projectForm')?.addEventListener('submit', async function (event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(this));
    data.skill_ids = [...this.querySelectorAll('input[name="project_skill"]:checked')].map(input => input.value);
    delete data.project_skill;
    const result = await apiCall('/api/projects', 'POST', data);
    if (result.success) location.reload();
    else showToast(result.error || 'Progetto non creato', 'error');
  });

  const scheduleModal = document.getElementById('scheduleModal');
  scheduleModal?.querySelectorAll('input[name="schedule_skill"]').forEach(input => input.addEventListener('change', () => {
    const count = scheduleModal.querySelectorAll('input[name="schedule_skill"]:checked').length;
    if (count > skillLimit) { input.checked = false; showToast(`Puoi selezionare al massimo ${skillLimit} Skills.`, 'error'); }
  }));
  document.getElementById('openScheduleModal')?.addEventListener('click', () => {
    document.getElementById('scheduleProjectId').value = document.getElementById('taskProject')?.value || '';
    document.getElementById('scheduleMode').value = taskMode?.value || 'autonomous';
    const selected = new Set(selectedSkillIds());
    scheduleModal.querySelectorAll('input[name="schedule_skill"]').forEach(input => { input.checked = selected.has(input.value); });
    scheduleModal.classList.remove('hidden');
  });
  document.querySelector('[data-close-schedule]')?.addEventListener('click', () => scheduleModal.classList.add('hidden'));
  scheduleModal?.addEventListener('click', event => { if (event.target === scheduleModal) scheduleModal.classList.add('hidden'); });
  document.getElementById('scheduleForm')?.addEventListener('submit', async function (event) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(this));
    data.skill_ids = [...this.querySelectorAll('input[name="schedule_skill"]:checked')].map(input => input.value);
    delete data.schedule_skill;
    const result = await apiCall('/api/schedules', 'POST', data);
    if (result.success) location.reload();
    else showToast(result.error || 'Pianificazione non creata', 'error');
  });
  document.querySelectorAll('[data-schedule-toggle]').forEach(button => button.addEventListener('click', async function () {
    this.disabled = true;
    const result = await apiCall(`/api/schedules/${this.dataset.scheduleToggle}/toggle`, 'POST');
    if (result.success) location.reload();
    else { showToast(result.error || 'Pianificazione non aggiornata', 'error'); this.disabled = false; }
  }));

  const taskPage = document.getElementById('taskPage');
  if (taskPage && !['completed', 'failed', 'stopped', 'waiting_configuration', 'waiting_approval'].includes(taskPage.dataset.taskStatus)) {
    const poll = setInterval(async () => {
      if (document.hidden) return;
      try {
        const response = await fetch(`/api/tasks/${taskPage.dataset.taskId}/state`, { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
        if (!response.ok) return;
        const state = await response.json();
        const changed = state.task.status !== taskPage.dataset.taskStatus || String(state.task.current_step) !== taskPage.dataset.taskStep || String(state.task.progress) !== taskPage.dataset.taskProgress || String(state.events.length) !== taskPage.dataset.eventCount || String(state.artifacts.length) !== taskPage.dataset.artifactCount;
        if (changed) { clearInterval(poll); location.reload(); }
      } catch {}
    }, 2500);
  }
});
