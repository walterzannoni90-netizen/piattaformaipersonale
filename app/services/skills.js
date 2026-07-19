const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../config/database');
const appConfig = require('../config/app');

const PACKAGE_SCHEMA = 'wes.skill/v1';
const CATEGORIES = Object.freeze({
  general: { label: 'General', icon: 'sparkles' },
  research: { label: 'Research', icon: 'binoculars' },
  sales: { label: 'Sales', icon: 'handshake' },
  marketing: { label: 'Marketing', icon: 'bullhorn' },
  data: { label: 'Data', icon: 'chart-column' },
  writing: { label: 'Writing', icon: 'pen-nib' },
  operations: { label: 'Operations', icon: 'gears' }
});

const TEMPLATE_LIBRARY = Object.freeze([
  Object.freeze({
    id: 'market-intelligence',
    name: 'Market Intelligence',
    category: 'research',
    description: 'Ricerca di mercato tracciabile, confronto concorrenti e opportunità prioritarie.',
    instructions: `Definisci prima il mercato, il pubblico e l'orizzonte temporale. Usa fonti primarie e recenti quando disponibili. Separa fatti verificati, stime e ipotesi. Per ogni concorrente confronta proposta di valore, segmento, canali, pricing pubblico, prove e debolezze. Chiudi con opportunità ordinate per impatto, confidenza, sforzo e una lista di verifiche ancora necessarie.`
  }),
  Object.freeze({
    id: 'sales-operator',
    name: 'Sales Operator',
    category: 'sales',
    description: 'Qualificazione lead, priorità commerciali e follow-up personalizzati senza invii impliciti.',
    instructions: `Analizza il contesto commerciale e qualifica ogni opportunità usando segnali espliciti. Non inventare bisogni, budget o urgenza. Proponi messaggi brevi e personalizzati con una sola call to action. Distingui sempre bozze da messaggi realmente inviati. Evidenzia obiezioni, prossimo passo, proprietario e data consigliata. Qualsiasi invio resta soggetto ad approvazione umana.`
  }),
  Object.freeze({
    id: 'data-auditor',
    name: 'Data Auditor',
    category: 'data',
    description: 'Analisi dati riproducibile con controlli qualità, metriche e limiti dichiarati.',
    instructions: `Controlla schema, tipi, valori mancanti, duplicati, anomalie e possibili bias prima dell'analisi. Usa Python soltanto nel runtime protetto. Mostra formule e assunzioni utili a riprodurre i risultati. Non dedurre causalità da semplici correlazioni. Consegna metriche chiave, visualizzazioni appropriate, limiti e azioni suggerite, distinguendo chiaramente dati osservati e interpretazione.`
  }),
  Object.freeze({
    id: 'brand-voice',
    name: 'Brand Voice Director',
    category: 'writing',
    description: 'Contenuti coerenti, distintivi e orientati alla conversione in più formati.',
    instructions: `Prima di scrivere identifica pubblico, consapevolezza, obiettivo, canale e tono. Mantieni una voce chiara, concreta e riconoscibile. Evita cliché, superlativi non dimostrati e testimonianze inventate. Produci una versione principale, alternative per headline e call to action, quindi verifica chiarezza, specificità, coerenza e conformità delle affermazioni.`
  })
]);

const PLAN_LIMITS = Object.freeze(Object.fromEntries(Object.entries(appConfig.plans).map(([plan, config]) => [plan, Object.freeze({
  library: Number(config.limits.skills_library),
  task: Number(config.limits.skills_per_task)
})])));

function skillError(message, code = 'SKILL_INVALID', status = 422) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function clean(value, max = 4000) {
  return String(value || '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

function normalizeCategory(value) {
  const category = clean(value, 30).toLowerCase();
  return Object.hasOwn(CATEGORIES, category) ? category : 'general';
}

function normalizeInput(input = {}) {
  const skill = {
    name: clean(input.name, 80),
    description: clean(input.description, 500),
    instructions: clean(input.instructions, 12_000),
    category: normalizeCategory(input.category)
  };
  if (skill.name.length < 3) throw skillError('Il nome della Skill deve contenere almeno 3 caratteri.');
  if (skill.instructions.length < 20) throw skillError('Le istruzioni della Skill devono contenere almeno 20 caratteri.');
  return skill;
}

function snapshotChecksum(skill) {
  const canonical = JSON.stringify({
    name: skill.name,
    description: skill.description || '',
    instructions: skill.instructions,
    category: skill.category
  });
  return crypto.createHash('sha256').update(canonical).digest('hex');
}

function slugify(value) {
  return clean(value, 80).normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 64) || 'skill';
}

function uniqueSlug(db, userId, name, excludeId = null) {
  const base = slugify(name);
  for (let counter = 1; counter <= 100; counter += 1) {
    const suffix = counter === 1 ? '' : `-${counter}`;
    const slug = `${base.slice(0, 64 - suffix.length)}${suffix}`;
    const existing = excludeId
      ? db.prepare('SELECT id FROM agent_skills WHERE user_id = ? AND slug = ? AND id <> ?').get(userId, slug, excludeId)
      : db.prepare('SELECT id FROM agent_skills WHERE user_id = ? AND slug = ?').get(userId, slug);
    if (!existing) return slug;
  }
  throw skillError('Impossibile generare un identificatore univoco per la Skill.', 'SKILL_CONFLICT', 409);
}

function accountLimits(db, userId) {
  const user = db.prepare('SELECT plan FROM users WHERE id = ? AND status = ?').get(userId, 'active');
  if (!user) throw skillError('Account non attivo.', 'ACCOUNT_INACTIVE', 403);
  return { plan: user.plan, ...(PLAN_LIMITS[user.plan] || PLAN_LIMITS.starter) };
}

function publicSkill(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description || '',
    instructions: row.instructions,
    category: row.category,
    source: row.source,
    version: Number(row.version),
    checksum: row.checksum,
    is_active: Boolean(Number(row.is_active)),
    version_count: Number(row.version_count || row.version || 1),
    created_at: row.created_at,
    updated_at: row.updated_at
  };
}

function listSkills(userId, options = {}) {
  const db = getDatabase();
  const activeClause = options.includeArchived ? '' : 'AND s.is_active = 1';
  return db.prepare(`SELECT s.*, (SELECT COUNT(*) FROM agent_skill_versions v WHERE v.skill_id = s.id) AS version_count
    FROM agent_skills s WHERE s.user_id = ? ${activeClause}
    ORDER BY s.is_active DESC, s.updated_at DESC, s.name ASC`).all(userId).map(publicSkill);
}

function getSkill(userId, skillId, options = {}) {
  const activeClause = options.includeArchived ? '' : 'AND s.is_active = 1';
  const row = getDatabase().prepare(`SELECT s.*, (SELECT COUNT(*) FROM agent_skill_versions v WHERE v.skill_id = s.id) AS version_count
    FROM agent_skills s WHERE s.id = ? AND s.user_id = ? ${activeClause}`).get(clean(skillId, 80), userId);
  return publicSkill(row);
}

function insertVersion(db, skill, userId, version, checksum) {
  db.prepare(`INSERT INTO agent_skill_versions
    (id, skill_id, user_id, version, name, description, instructions, category, checksum)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    uuidv4(), skill.id, userId, version, skill.name, skill.description, skill.instructions, skill.category, checksum
  );
}

function createSkill(userId, input, options = {}) {
  const db = getDatabase();
  const limits = accountLimits(db, userId);
  const activeCount = Number(db.prepare('SELECT COUNT(*) AS count FROM agent_skills WHERE user_id = ? AND is_active = 1').get(userId).count);
  if (activeCount >= limits.library) {
    throw skillError(`Limite di ${limits.library} Skills attive raggiunto per il piano ${limits.plan}.`, 'SKILL_LIMIT', 429);
  }
  const normalized = normalizeInput(input);
  const source = clean(options.source || 'custom', 100) || 'custom';
  if (source.startsWith('template:')) {
    const installed = db.prepare('SELECT id FROM agent_skills WHERE user_id = ? AND source = ? AND is_active = 1').get(userId, source);
    if (installed) throw skillError('Questo blueprint è già installato.', 'SKILL_ALREADY_INSTALLED', 409);
  }
  const skill = { id: uuidv4(), ...normalized };
  const checksum = snapshotChecksum(skill);
  const slug = uniqueSlug(db, userId, skill.name);
  db.prepare(`INSERT INTO agent_skills
    (id, user_id, name, slug, description, instructions, category, source, version, checksum)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`).run(
    skill.id, userId, skill.name, slug, skill.description, skill.instructions, skill.category, source, checksum
  );
  try {
    insertVersion(db, skill, userId, 1, checksum);
  } catch (error) {
    try { db.prepare('DELETE FROM agent_skills WHERE id = ? AND user_id = ?').run(skill.id, userId); } catch {}
    throw error;
  }
  return getSkill(userId, skill.id);
}

function updateSkill(userId, skillId, input, expectedVersion) {
  const db = getDatabase();
  const current = getSkill(userId, skillId, { includeArchived: true });
  if (!current) throw skillError('Skill non trovata.', 'SKILL_NOT_FOUND', 404);
  if (!current.is_active) throw skillError('Una Skill archiviata non può essere modificata.', 'SKILL_ARCHIVED', 409);
  const version = Number(expectedVersion);
  if (!Number.isInteger(version) || version !== current.version) {
    throw skillError('La Skill è stata aggiornata altrove. Ricarica la pagina prima di salvare.', 'SKILL_VERSION_CONFLICT', 409);
  }
  const normalized = normalizeInput({
    name: input.name ?? current.name,
    description: input.description ?? current.description,
    instructions: input.instructions ?? current.instructions,
    category: input.category ?? current.category
  });
  const checksum = snapshotChecksum(normalized);
  if (checksum === current.checksum) return current;
  const nextVersion = current.version + 1;
  const slug = uniqueSlug(db, userId, normalized.name, current.id);
  const updated = db.prepare(`UPDATE agent_skills SET name = ?, slug = ?, description = ?, instructions = ?, category = ?,
    version = ?, checksum = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ? AND version = ? AND is_active = 1`)
    .run(normalized.name, slug, normalized.description, normalized.instructions, normalized.category, nextVersion, checksum, current.id, userId, current.version);
  if (updated.changes !== 1) throw skillError('Conflitto di versione. Nessuna modifica applicata.', 'SKILL_VERSION_CONFLICT', 409);
  try {
    insertVersion(db, { id: current.id, ...normalized }, userId, nextVersion, checksum);
  } catch (error) {
    try {
      db.prepare(`UPDATE agent_skills SET name = ?, slug = ?, description = ?, instructions = ?, category = ?,
        version = ?, checksum = ?, updated_at = ? WHERE id = ? AND user_id = ? AND version = ?`)
        .run(current.name, current.slug, current.description, current.instructions, current.category,
          current.version, current.checksum, current.updated_at, current.id, userId, nextVersion);
    } catch {}
    throw error;
  }
  return getSkill(userId, current.id);
}

function archiveSkill(userId, skillId) {
  const db = getDatabase();
  const current = getSkill(userId, skillId, { includeArchived: true });
  if (!current) throw skillError('Skill non trovata.', 'SKILL_NOT_FOUND', 404);
  if (!current.is_active) return current;
  db.prepare('DELETE FROM project_skill_bindings WHERE skill_id = ? AND user_id = ?').run(current.id, userId);
  db.prepare('UPDATE agent_skills SET is_active = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(current.id, userId);
  return getSkill(userId, current.id, { includeArchived: true });
}

function installTemplate(userId, templateId) {
  const template = TEMPLATE_LIBRARY.find((item) => item.id === clean(templateId, 80));
  if (!template) throw skillError('Blueprint non trovato.', 'SKILL_TEMPLATE_NOT_FOUND', 404);
  return createSkill(userId, template, { source: `template:${template.id}` });
}

function parseSkillIds(value) {
  let values = value;
  if (typeof values === 'string') {
    const raw = values.trim();
    if (!raw) return [];
    try { values = JSON.parse(raw); } catch { values = raw.split(','); }
  }
  if (!Array.isArray(values)) values = values == null ? [] : [values];
  const ids = values.map((item) => clean(item, 80)).filter(Boolean);
  return [...new Set(ids)].slice(0, 50);
}

function rowsByIds(db, userId, ids) {
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  return db.prepare(`SELECT * FROM agent_skills WHERE user_id = ? AND is_active = 1 AND id IN (${placeholders})`).all(userId, ...ids);
}

function projectSkillIds(db, userId, projectId) {
  if (!projectId) return [];
  const project = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ? AND archived = 0').get(projectId, userId);
  if (!project) throw skillError('Progetto non trovato.', 'PROJECT_NOT_FOUND', 404);
  return db.prepare(`SELECT b.skill_id FROM project_skill_bindings b
    JOIN agent_skills s ON s.id = b.skill_id AND s.user_id = b.user_id
    WHERE b.project_id = ? AND b.user_id = ? AND s.is_active = 1 ORDER BY b.position ASC, b.created_at ASC`)
    .all(projectId, userId).map((row) => row.skill_id);
}

function resolveSelection(userId, projectId, requestedIds = []) {
  const db = getDatabase();
  const explicit = parseSkillIds(requestedIds);
  const defaults = projectSkillIds(db, userId, projectId);
  const orderedIds = [...new Set([...defaults, ...explicit])];
  const limits = accountLimits(db, userId);
  if (orderedIds.length > limits.task) {
    throw skillError(`Puoi applicare al massimo ${limits.task} Skills a un singolo task.`, 'TASK_SKILL_LIMIT', 422);
  }
  const rows = rowsByIds(db, userId, orderedIds);
  const byId = new Map(rows.map((row) => [row.id, row]));
  const missingExplicit = explicit.filter((id) => !byId.has(id));
  if (missingExplicit.length) throw skillError('Una delle Skills selezionate non esiste o non appartiene al tuo workspace.', 'SKILL_NOT_FOUND', 404);
  return orderedIds.map((id) => byId.get(id)).filter(Boolean);
}

function snapshotTaskSkills({ taskId, userId, projectId = null, skillIds = [] }) {
  const db = getDatabase();
  const task = db.prepare('SELECT id FROM agent_tasks WHERE id = ? AND user_id = ?').get(taskId, userId);
  if (!task) throw skillError('Task non trovato.', 'TASK_NOT_FOUND', 404);
  const selected = resolveSelection(userId, projectId, skillIds);
  selected.forEach((skill, position) => {
    db.prepare(`INSERT INTO task_skill_bindings
      (task_id, skill_id, user_id, skill_version, name_snapshot, description_snapshot, instructions_snapshot, category_snapshot, checksum, position)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      taskId, skill.id, userId, skill.version, skill.name, skill.description, skill.instructions, skill.category, skill.checksum, position
    );
  });
  return getTaskSkills(taskId, userId);
}

function getTaskSkills(taskId, userId) {
  return getDatabase().prepare(`SELECT skill_id AS id, skill_version AS version, name_snapshot AS name,
    description_snapshot AS description, instructions_snapshot AS instructions, category_snapshot AS category,
    checksum, position, created_at FROM task_skill_bindings WHERE task_id = ? AND user_id = ? ORDER BY position ASC, created_at ASC`)
    .all(taskId, userId).map((row) => ({ ...row, version: Number(row.version), position: Number(row.position) }));
}

function getVerifiedTaskSkills(taskId, userId) {
  const skills = getTaskSkills(taskId, userId);
  const changed = skills.find((skill) => snapshotChecksum(skill) !== skill.checksum);
  if (changed) {
    throw skillError(`Controllo d’integrità non superato per la Skill “${changed.name}”.`, 'TASK_SKILL_INTEGRITY_FAILED', 409);
  }
  return skills;
}

function setProjectSkills(userId, projectId, skillIds) {
  const db = getDatabase();
  const project = db.prepare('SELECT id FROM projects WHERE id = ? AND user_id = ? AND archived = 0').get(projectId, userId);
  if (!project) throw skillError('Progetto non trovato.', 'PROJECT_NOT_FOUND', 404);
  const selected = resolveSelection(userId, null, skillIds);
  db.prepare('DELETE FROM project_skill_bindings WHERE project_id = ? AND user_id = ?').run(projectId, userId);
  selected.forEach((skill, position) => {
    db.prepare('INSERT INTO project_skill_bindings (project_id, skill_id, user_id, position) VALUES (?, ?, ?, ?)')
      .run(projectId, skill.id, userId, position);
  });
  return selected.map(publicSkill);
}

function getProjectSkillMap(userId) {
  const rows = getDatabase().prepare(`SELECT b.project_id, b.skill_id FROM project_skill_bindings b
    JOIN projects p ON p.id = b.project_id AND p.user_id = b.user_id AND p.archived = 0
    JOIN agent_skills s ON s.id = b.skill_id AND s.user_id = b.user_id AND s.is_active = 1
    WHERE b.user_id = ? ORDER BY b.position ASC, b.created_at ASC`).all(userId);
  return rows.reduce((map, row) => {
    if (!map[row.project_id]) map[row.project_id] = [];
    map[row.project_id].push(row.skill_id);
    return map;
  }, {});
}

function packageCore(skill) {
  return {
    schema: PACKAGE_SCHEMA,
    name: skill.name,
    description: skill.description || '',
    category: skill.category,
    instructions: skill.instructions
  };
}

function exportSkill(userId, skillId) {
  const skill = getSkill(userId, skillId);
  if (!skill) throw skillError('Skill non trovata.', 'SKILL_NOT_FOUND', 404);
  const core = packageCore(skill);
  const digest = crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex');
  return {
    ...core,
    exported_version: skill.version,
    exported_at: new Date().toISOString(),
    integrity: { algorithm: 'sha256', digest }
  };
}

function importSkill(userId, payload) {
  let parsed = payload;
  if (typeof parsed === 'string') {
    if (Buffer.byteLength(parsed) > 30_000) throw skillError('Pacchetto Skill troppo grande.');
    try { parsed = JSON.parse(parsed); } catch { throw skillError('Il file non contiene JSON valido.'); }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || parsed.schema !== PACKAGE_SCHEMA) {
    throw skillError(`Formato non supportato. È richiesto ${PACKAGE_SCHEMA}.`);
  }
  const normalized = normalizeInput(parsed);
  const core = packageCore(normalized);
  const expected = crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex');
  const supplied = clean(parsed.integrity?.digest, 128).toLowerCase();
  if (parsed.integrity?.algorithm !== 'sha256' || !/^[a-f0-9]{64}$/.test(supplied) || supplied !== expected) {
    throw skillError('Controllo d’integrità non superato: il pacchetto potrebbe essere incompleto o modificato.', 'SKILL_INTEGRITY_FAILED', 422);
  }
  return createSkill(userId, normalized, { source: 'import' });
}

function listVersions(userId, skillId) {
  const skill = getSkill(userId, skillId, { includeArchived: true });
  if (!skill) throw skillError('Skill non trovata.', 'SKILL_NOT_FOUND', 404);
  return getDatabase().prepare(`SELECT version, name, description, category, checksum, created_at
    FROM agent_skill_versions WHERE skill_id = ? AND user_id = ? ORDER BY version DESC`).all(skill.id, userId)
    .map((row) => ({ ...row, version: Number(row.version) }));
}

function templates() {
  return TEMPLATE_LIBRARY.map((template) => ({ ...template, meta: CATEGORIES[template.category] }));
}

function limitsForUser(userId) {
  return accountLimits(getDatabase(), userId);
}

module.exports = {
  PACKAGE_SCHEMA,
  CATEGORIES,
  PLAN_LIMITS,
  clean,
  normalizeInput,
  snapshotChecksum,
  parseSkillIds,
  listSkills,
  getSkill,
  createSkill,
  updateSkill,
  archiveSkill,
  installTemplate,
  resolveSelection,
  snapshotTaskSkills,
  getTaskSkills,
  getVerifiedTaskSkills,
  setProjectSkills,
  getProjectSkillMap,
  exportSkill,
  importSkill,
  listVersions,
  templates,
  limitsForUser
};
