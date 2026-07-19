const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dbFile = path.join('/tmp', `wes-skills-${process.pid}.db`);
try { fs.unlinkSync(dbFile); } catch {}
process.env.DB_PATH = dbFile;

test('WES Skills are versioned, tenant-isolated, pinned to tasks and integrity checked', async (t) => {
  t.after(() => { try { fs.unlinkSync(dbFile); } catch {} });
  const { initDatabase } = require('../app/config/database');
  const db = await initDatabase();
  const skills = require('../app/services/skills');

  db.prepare('INSERT INTO users (id, email, password, company_name, plan) VALUES (?, ?, ?, ?, ?)')
    .run('skill-owner', 'skills-owner@example.test', 'hash', 'Owner', 'pro');
  db.prepare('INSERT INTO users (id, email, password, company_name, plan) VALUES (?, ?, ?, ?, ?)')
    .run('skill-other', 'skills-other@example.test', 'hash', 'Other', 'starter');

  const created = skills.createSkill('skill-owner', {
    name: 'Commercial Audit', category: 'sales', description: 'Controlla la pipeline.',
    instructions: 'Verifica dati mancanti, priorità, obiezioni e prossimo passo per ogni opportunità.'
  });
  assert.equal(created.version, 1);
  assert.match(created.checksum, /^[a-f0-9]{64}$/);

  const updated = skills.updateSkill('skill-owner', created.id, {
    ...created,
    instructions: `${created.instructions} Consegna anche una tabella delle priorità.`
  }, 1);
  assert.equal(updated.version, 2);
  assert.equal(skills.listVersions('skill-owner', created.id).length, 2);
  assert.throws(() => skills.updateSkill('skill-owner', created.id, updated, 1), (error) => error.code === 'SKILL_VERSION_CONFLICT');
  assert.equal(skills.getSkill('skill-other', created.id), null);

  db.prepare('INSERT INTO projects (id, user_id, name) VALUES (?, ?, ?)').run('skill-project', 'skill-owner', 'Project');
  skills.setProjectSkills('skill-owner', 'skill-project', [created.id]);
  db.prepare('INSERT INTO agent_tasks (id, user_id, project_id, title, prompt) VALUES (?, ?, ?, ?, ?)')
    .run('skill-task-v2', 'skill-owner', 'skill-project', 'Task v2', 'Applica la skill al progetto.');
  const pinnedV2 = skills.snapshotTaskSkills({ taskId: 'skill-task-v2', userId: 'skill-owner', projectId: 'skill-project' });
  assert.equal(pinnedV2[0].version, 2);

  const versionThree = skills.updateSkill('skill-owner', created.id, {
    ...updated,
    instructions: `${updated.instructions} Evidenzia infine i rischi di previsione.`
  }, 2);
  assert.equal(versionThree.version, 3);
  assert.equal(skills.getVerifiedTaskSkills('skill-task-v2', 'skill-owner')[0].version, 2, 'existing task must keep its snapshot');

  db.prepare('INSERT INTO agent_tasks (id, user_id, project_id, title, prompt) VALUES (?, ?, ?, ?, ?)')
    .run('skill-task-v3', 'skill-owner', 'skill-project', 'Task v3', 'Usa la versione corrente.');
  assert.equal(skills.snapshotTaskSkills({ taskId: 'skill-task-v3', userId: 'skill-owner', projectId: 'skill-project' })[0].version, 3);

  db.prepare('INSERT INTO agent_tasks (id, user_id, title, prompt) VALUES (?, ?, ?, ?)')
    .run('other-task', 'skill-other', 'Other', 'Do not cross tenant boundaries.');
  assert.throws(() => skills.snapshotTaskSkills({ taskId: 'other-task', userId: 'skill-other', skillIds: [created.id] }),
    (error) => error.code === 'SKILL_NOT_FOUND');

  const exported = skills.exportSkill('skill-owner', created.id);
  const imported = skills.importSkill('skill-other', exported);
  assert.equal(imported.name, versionThree.name);
  assert.equal(imported.source, 'import');
  assert.throws(() => skills.importSkill('skill-other', { ...exported, instructions: `${exported.instructions} tampered` }),
    (error) => error.code === 'SKILL_INTEGRITY_FAILED');

  db.prepare(`INSERT INTO task_schedules
    (id, user_id, name, prompt, mode, skill_ids, cron_expression, timezone, next_run)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    'skill-schedule', 'skill-owner', 'Scheduled skill task', 'Esegui il playbook commerciale pianificato.', 'autonomous',
    JSON.stringify([created.id]), '0 9 * * *', 'Europe/Rome', '2000-01-01T09:00:00.000Z'
  );
  const scheduleService = require('../app/services/scheduleService');
  await scheduleService.processDueSchedules();
  const scheduledTask = db.prepare('SELECT id FROM agent_tasks WHERE user_id = ? AND title = ?').get('skill-owner', 'Scheduled skill task');
  assert.ok(scheduledTask);
  assert.equal(skills.getVerifiedTaskSkills(scheduledTask.id, 'skill-owner')[0].version, 3);
  require('../app/services/agentOrchestrator').stopTask(scheduledTask.id, 'skill-owner');

  db.prepare('UPDATE task_skill_bindings SET instructions_snapshot = ? WHERE task_id = ?').run('tampered snapshot', 'skill-task-v3');
  assert.throws(() => skills.getVerifiedTaskSkills('skill-task-v3', 'skill-owner'),
    (error) => error.code === 'TASK_SKILL_INTEGRITY_FAILED');
  scheduleService.stop();
  await require('../app/services/agentOrchestrator').shutdown(2_000);
});
