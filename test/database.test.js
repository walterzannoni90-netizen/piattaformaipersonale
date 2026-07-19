const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dbFile = path.join('/tmp', `wes-test-${process.pid}.db`);
try { fs.unlinkSync(dbFile); } catch {}
process.env.DB_PATH = dbFile;

test('database initializes the complete schema and persists writes', async (t) => {
  t.after(() => { try { fs.unlinkSync(dbFile); } catch {} });
  const { initDatabase } = require('../app/config/database');
  const db = await initDatabase();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  for (const table of ['users', 'agents', 'leads', 'conversations', 'appointments', 'automations', 'integrations', 'logs',
    'agent_tasks', 'task_events', 'task_artifacts', 'projects', 'project_memories', 'workspace_files', 'task_approvals',
    'task_schedules', 'inbound_requests', 'processed_webhook_events']) {
    assert.ok(tables.includes(table), `missing table ${table}`);
  }
  assert.ok(db.prepare('PRAGMA table_info(task_schedules)').all().some((column) => column.name === 'mode'));
  db.prepare('INSERT INTO users (id, email, password, company_name) VALUES (?, ?, ?, ?)')
    .run('test-user', 'test@example.com', 'hash', 'Test Company');
  assert.equal(db.prepare('SELECT company_name FROM users WHERE id = ?').get('test-user').company_name, 'Test Company');
  assert.equal(db.prepare('UPDATE users SET company_name = ? WHERE id = ?').run('Updated Company', 'test-user').changes, 1);
  assert.equal(db.prepare('UPDATE users SET company_name = ? WHERE id = ?').run('Nobody', 'missing-user').changes, 0);
  assert.equal(db.prepare('SELECT company_name FROM users WHERE id = ?').get('test-user').company_name, 'Updated Company');
  assert.ok(fs.existsSync(dbFile));
  if (process.platform !== 'win32') assert.equal(fs.statSync(dbFile).mode & 0o077, 0, 'database file must not be group/world accessible');
  assert.equal(fs.existsSync(`${dbFile}.tmp-${process.pid}`), false, 'atomic save temp file must be cleaned');
});

test('agent data remains isolated by user ownership', async () => {
  const { initDatabase } = require('../app/config/database');
  const db = await initDatabase();
  db.prepare('INSERT INTO users (id, email, password, company_name) VALUES (?, ?, ?, ?)').run('owner-a', 'a@example.com', 'hash', 'A');
  db.prepare('INSERT INTO users (id, email, password, company_name) VALUES (?, ?, ?, ?)').run('owner-b', 'b@example.com', 'hash', 'B');
  db.prepare('INSERT INTO agent_tasks (id, user_id, title, prompt) VALUES (?, ?, ?, ?)').run('task-a', 'owner-a', 'Private A', 'Only A');
  db.prepare('INSERT INTO agent_tasks (id, user_id, title, prompt) VALUES (?, ?, ?, ?)').run('task-b', 'owner-b', 'Private B', 'Only B');
  const rows = db.prepare('SELECT id FROM agent_tasks WHERE user_id = ?').all('owner-a');
  assert.deepEqual(rows, [{ id: 'task-a' }]);
});
