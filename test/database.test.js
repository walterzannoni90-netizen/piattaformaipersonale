const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dbFile = path.join('/tmp', `wes-test-${process.pid}.db`);
process.env.DB_PATH = dbFile;

test('database initializes the complete schema and persists writes', async (t) => {
  t.after(() => { try { fs.unlinkSync(dbFile); } catch {} });
  const { initDatabase } = require('../app/config/database');
  const db = await initDatabase();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((row) => row.name);
  for (const table of ['users', 'agents', 'leads', 'conversations', 'appointments', 'automations', 'integrations', 'logs']) {
    assert.ok(tables.includes(table), `missing table ${table}`);
  }
  db.prepare('INSERT INTO users (id, email, password, company_name) VALUES (?, ?, ?, ?)')
    .run('test-user', 'test@example.com', 'hash', 'Test Company');
  assert.equal(db.prepare('SELECT company_name FROM users WHERE id = ?').get('test-user').company_name, 'Test Company');
  assert.ok(fs.existsSync(dbFile));
});
