const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const dbFile = path.join('/tmp', `wes-orchestrator-${process.pid}.db`);
const workspaceRoot = path.join('/tmp', `wes-orchestrator-workspaces-${process.pid}`);
process.env.DB_PATH = dbFile;
process.env.AGENT_WORKSPACE_ROOT = workspaceRoot;
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

let db;
let orchestrator;

async function waitForTask(id, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const task = db.prepare('SELECT * FROM agent_tasks WHERE id = ?').get(id);
    if (task && predicate(task)) return task;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timeout waiting for task ${id}`);
}

test.before(async () => {
  try { fs.unlinkSync(dbFile); } catch {}
  db = await require('../app/config/database').initDatabase();
  orchestrator = require('../app/services/agentOrchestrator');
  db.prepare('INSERT INTO users (id, email, password, company_name) VALUES (?, ?, ?, ?)')
    .run('action-owner', 'owner@example.test', 'hash', 'Owner');
  db.prepare(`INSERT INTO leads (id, user_id, name, email, status, score)
    VALUES ('action-lead', 'action-owner', 'Cliente Test', 'cliente@example.test', 'new', 0)`).run();
});

test.after(async () => {
  await orchestrator.shutdown(2000);
  try { fs.unlinkSync(dbFile); } catch {}
  try { fs.rmSync(workspaceRoot, { recursive: true, force: true }); } catch {}
});

test('external CRM action requires exact approval and executes only after it', async () => {
  const taskId = 'approved-action-task';
  const result = 'Report operativo verificato. '.repeat(8);
  const plan = [
    { id: 'review', title: 'Controllo qualità', description: 'Verifica prima di agire', tool: 'quality_review', input: {} },
    { id: 'update', title: 'Qualifica il lead', description: 'Modifica esterna', tool: 'update_lead_status', input: { lead_id: 'action-lead', status: 'qualified' } }
  ];
  db.prepare(`INSERT INTO agent_tasks (id, user_id, title, prompt, status, progress, plan, result)
    VALUES (?, 'action-owner', 'Azione controllata', 'Qualifica il lead dopo il controllo', 'running', 50, ?, ?)`)
    .run(taskId, JSON.stringify(plan), result);

  orchestrator.startTask(taskId);
  await waitForTask(taskId, (task) => task.status === 'waiting_approval');
  const approval = db.prepare('SELECT * FROM task_approvals WHERE task_id = ?').get(taskId);
  assert.equal(approval.status, 'pending');
  assert.equal(approval.action_type, 'update_lead_status');
  assert.equal(db.prepare('SELECT status FROM leads WHERE id = ?').get('action-lead').status, 'new');
  const payload = JSON.parse(approval.payload);
  assert.equal(payload.lead_id, 'action-lead');
  assert.equal(payload.status, 'qualified');
  assert.equal(payload._resume_same_step, true);

  db.prepare("UPDATE task_approvals SET status = 'approved', decided_at = CURRENT_TIMESTAMP WHERE id = ?").run(approval.id);
  db.prepare("UPDATE agent_tasks SET status = 'running', needs_approval = 0 WHERE id = ?").run(taskId);
  orchestrator.startTask(taskId);
  await waitForTask(taskId, (task) => task.status === 'completed');

  assert.equal(db.prepare('SELECT status FROM leads WHERE id = ?').get('action-lead').status, 'qualified');
  assert.equal(db.prepare('SELECT status FROM task_approvals WHERE id = ?').get(approval.id).status, 'executed');
  assert.ok(db.prepare('SELECT COUNT(*) AS count FROM task_artifacts WHERE task_id = ?').get(taskId).count >= 1);
});

test('failed quality review blocks approval creation and external changes', async () => {
  db.prepare("UPDATE leads SET status = 'new' WHERE id = 'action-lead'").run();
  const taskId = 'failed-quality-task';
  const plan = [
    { id: 'review', title: 'Controllo qualità', description: 'Output insufficiente', tool: 'quality_review', input: {} },
    { id: 'update', title: 'Qualifica il lead', description: 'Non deve avvenire', tool: 'update_lead_status', input: { lead_id: 'action-lead', status: 'qualified' } }
  ];
  db.prepare(`INSERT INTO agent_tasks (id, user_id, title, prompt, status, progress, plan, result)
    VALUES (?, 'action-owner', 'Qualità insufficiente', 'Non eseguire azioni senza qualità', 'running', 50, ?, 'breve')`)
    .run(taskId, JSON.stringify(plan));

  orchestrator.startTask(taskId);
  const failed = await waitForTask(taskId, (task) => task.status === 'failed');
  assert.match(failed.error, /Controllo qualità non superato/);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM task_approvals WHERE task_id = ?').get(taskId).count, 0);
  assert.equal(db.prepare('SELECT status FROM leads WHERE id = ?').get('action-lead').status, 'new');
});
