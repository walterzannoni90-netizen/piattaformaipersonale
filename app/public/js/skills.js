document.addEventListener('DOMContentLoaded', () => {
  const modal = document.getElementById('skillModal');
  const form = document.getElementById('skillForm');
  const title = document.getElementById('skillModalTitle');
  const instructionInput = form?.elements.instructions;
  const instructionCount = document.getElementById('skillInstructionCount');

  const updateCount = () => { if (instructionCount) instructionCount.textContent = String(instructionInput?.value.length || 0); };
  const openModal = (skill = null) => {
    form?.reset();
    if (form) {
      form.elements.skill_id.value = skill?.id || '';
      form.elements.expected_version.value = skill?.version || '';
      form.elements.name.value = skill?.name || '';
      form.elements.category.value = skill?.category || 'general';
      form.elements.description.value = skill?.description || '';
      form.elements.instructions.value = skill?.instructions || '';
    }
    if (title) title.textContent = skill ? `Modifica ${skill.name}` : 'Crea una WES Skill';
    updateCount();
    modal?.classList.remove('hidden');
    setTimeout(() => form?.elements.name.focus(), 20);
  };
  const closeModal = () => modal?.classList.add('hidden');

  document.querySelectorAll('[data-open-skill-modal]').forEach(button => button.addEventListener('click', () => openModal()));
  document.querySelectorAll('[data-close-skill-modal]').forEach(button => button.addEventListener('click', closeModal));
  modal?.addEventListener('click', event => { if (event.target === modal) closeModal(); });
  instructionInput?.addEventListener('input', updateCount);

  form?.addEventListener('submit', async event => {
    event.preventDefault();
    const button = form.querySelector('button[type="submit"]');
    const values = Object.fromEntries(new FormData(form));
    const skillId = values.skill_id;
    delete values.skill_id;
    if (!skillId) delete values.expected_version;
    button.disabled = true;
    button.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i><span>Blocco la versione…</span>';
    const result = await apiCall(skillId ? `/api/skills/${skillId}` : '/api/skills', skillId ? 'PATCH' : 'POST', values);
    if (result.success) {
      showToast(skillId ? `Versione ${result.skill.version} creata` : 'Skill creata e verificata');
      location.reload();
    } else {
      showToast(result.error || 'Skill non salvata', 'error');
      button.disabled = false;
      button.innerHTML = '<span>Salva versione</span><i class="fas fa-check"></i>';
    }
  });

  document.querySelectorAll('[data-edit-skill]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    const result = await apiCall(`/api/skills/${button.dataset.editSkill}`);
    button.disabled = false;
    if (result.success) openModal(result.skill);
    else showToast(result.error || 'Skill non disponibile', 'error');
  }));

  document.querySelectorAll('[data-install-template]').forEach(button => button.addEventListener('click', async () => {
    if (button.disabled) return;
    button.disabled = true;
    const original = button.innerHTML;
    button.innerHTML = '<i class="fas fa-circle-notch fa-spin"></i> Installazione…';
    const result = await apiCall(`/api/skills/templates/${button.dataset.installTemplate}/install`, 'POST');
    if (result.success) {
      showToast(`${result.skill.name} installata`);
      location.reload();
    } else {
      showToast(result.error || 'Blueprint non installato', 'error');
      button.disabled = false;
      button.innerHTML = original;
    }
  }));

  document.querySelectorAll('[data-archive-skill]').forEach(button => button.addEventListener('click', async () => {
    if (!confirm('Archiviare questa Skill? I task esistenti manterranno la propria versione bloccata.')) return;
    button.disabled = true;
    const result = await apiCall(`/api/skills/${button.dataset.archiveSkill}/archive`, 'POST');
    if (result.success) location.reload();
    else { showToast(result.error || 'Skill non archiviata', 'error'); button.disabled = false; }
  }));

  const historyModal = document.getElementById('skillHistoryModal');
  const historyTitle = document.getElementById('skillHistoryTitle');
  const versionList = document.getElementById('skillVersionList');
  const closeHistory = () => historyModal?.classList.add('hidden');
  document.querySelector('[data-close-skill-history]')?.addEventListener('click', closeHistory);
  historyModal?.addEventListener('click', event => { if (event.target === historyModal) closeHistory(); });
  document.querySelectorAll('[data-skill-history]').forEach(button => button.addEventListener('click', async () => {
    button.disabled = true;
    const result = await apiCall(`/api/skills/${button.dataset.skillHistory}/versions`);
    button.disabled = false;
    if (!result.success) { showToast(result.error || 'Cronologia non disponibile', 'error'); return; }
    if (historyTitle) historyTitle.textContent = button.dataset.skillName || 'Cronologia Skill';
    if (versionList) {
      versionList.replaceChildren(...result.versions.map(version => {
        const row = document.createElement('div');
        const marker = document.createElement('span');
        marker.textContent = `v${version.version}`;
        const detail = document.createElement('div');
        const name = document.createElement('b');
        name.textContent = version.name;
        const metadata = document.createElement('small');
        metadata.textContent = `${version.category} · ${new Date(version.created_at).toLocaleString('it-IT')} · ${version.checksum.slice(0, 12)}`;
        detail.append(name, metadata);
        const fingerprint = document.createElement('i');
        fingerprint.className = 'fas fa-fingerprint';
        row.append(marker, detail, fingerprint);
        return row;
      }));
    }
    historyModal?.classList.remove('hidden');
  }));

  const importButton = document.getElementById('importSkillButton');
  const importFile = document.getElementById('importSkillFile');
  importButton?.addEventListener('click', () => importFile.click());
  importFile?.addEventListener('change', async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    if (file.size > 30_000) { showToast('Il pacchetto supera 30 KB.', 'error'); importFile.value = ''; return; }
    importButton.disabled = true;
    try {
      const packageData = JSON.parse(await file.text());
      const result = await apiCall('/api/skills/import', 'POST', { package: packageData });
      if (!result.success) throw new Error(result.error || 'Pacchetto non accettato');
      showToast(`${result.skill.name} importata con integrità verificata`);
      location.reload();
    } catch (error) {
      showToast(error.message || 'File JSON non valido', 'error');
      importButton.disabled = false;
      importFile.value = '';
    }
  });

  document.querySelectorAll('[data-skill-filter]').forEach(button => button.addEventListener('click', () => {
    document.querySelectorAll('[data-skill-filter]').forEach(item => item.classList.toggle('active', item === button));
    const showAll = button.dataset.skillFilter === 'all';
    document.querySelectorAll('[data-skill-state]').forEach(card => card.classList.toggle('hidden', !showAll && card.dataset.skillState !== 'active'));
  }));
});
