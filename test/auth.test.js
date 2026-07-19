const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');

const dbFile = path.join('/tmp', `wes-auth-test-${process.pid}.db`);
try { fs.unlinkSync(dbFile); } catch {}
process.env.DB_PATH = dbFile;
process.env.JWT_SECRET = crypto.randomBytes(32).toString('hex');

test('public registration is closed by default in production and requires an explicit opt-in', () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousSetting = process.env.ALLOW_PUBLIC_REGISTRATION;
  const appConfig = require('../app/config/app');
  process.env.NODE_ENV = 'production';
  delete process.env.ALLOW_PUBLIC_REGISTRATION;
  assert.equal(appConfig.isRegistrationOpen(), false);
  process.env.ALLOW_PUBLIC_REGISTRATION = 'true';
  assert.equal(appConfig.isRegistrationOpen(), true);
  if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = previousNodeEnv;
  if (previousSetting === undefined) delete process.env.ALLOW_PUBLIC_REGISTRATION;
  else process.env.ALLOW_PUBLIC_REGISTRATION = previousSetting;
});

test('session version revokes every token issued before a password reset', async (t) => {
  t.after(() => { try { fs.unlinkSync(dbFile); } catch {} });
  const { initDatabase } = require('../app/config/database');
  const db = await initDatabase();
  db.prepare(`INSERT INTO users (id, email, password, company_name, session_version)
    VALUES (?, ?, ?, ?, 0)`).run('session-user', 'session@example.test', 'hash', 'Session Test');

  const { verifiedUser } = require('../app/middleware/auth');
  const token = jwt.sign({ id: 'session-user', session_version: 0 }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  assert.equal(verifiedUser(token).id, 'session-user');

  db.prepare('UPDATE users SET session_version = session_version + 1 WHERE id = ?').run('session-user');
  assert.throws(() => verifiedUser(token), /Sessione revocata/);

  const legacyToken = jwt.sign({ id: 'session-user' }, process.env.JWT_SECRET, { algorithm: 'HS256' });
  assert.throws(() => verifiedUser(legacyToken), /Sessione revocata/);
});
