'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BrowserSessionManager } = require('../app/services/browserSession');

test('browser sessions are tenant and task scoped', () => {
  const manager = new BrowserSessionManager({ maxSessionsPerUser: 1, sessionTtlMs: 60_000 });
  const session = manager.create({ userId: 'user-1', taskId: 'task-1' });
  assert.equal(manager.get({ sessionId: session.id, userId: 'user-2' }), null);
  assert.throws(() => manager.prepareCommand({
    sessionId: session.id,
    userId: 'user-1',
    taskId: 'task-2',
    command: { action: 'screenshot' }
  }), /non disponibile/);
  assert.throws(() => manager.create({ userId: 'user-1', taskId: 'task-2' }), /Limite/);
});

test('read commands do not require approval while submit does', () => {
  const manager = new BrowserSessionManager();
  const session = manager.create({ userId: 7, taskId: 11 });
  const read = manager.prepareCommand({
    sessionId: session.id,
    userId: 7,
    taskId: 11,
    command: { action: 'navigate', url: 'https://example.com' }
  });
  const write = manager.prepareCommand({
    sessionId: session.id,
    userId: 7,
    taskId: 11,
    command: { action: 'submit', selector: '#confirm', value: 'yes' }
  });
  assert.equal(read.approvalRequired, false);
  assert.equal(write.approvalRequired, true);
  assert.notEqual(read.approvalHash, write.approvalHash);
});

test('session command history is bounded and closing is idempotent', () => {
  const manager = new BrowserSessionManager();
  const session = manager.create({ userId: 'u', taskId: 't' });
  for (let index = 0; index < 205; index += 1) {
    manager.recordCommand({
      sessionId: session.id,
      userId: 'u',
      command: { action: 'screenshot' },
      status: 'completed'
    });
  }
  assert.equal(manager.get({ sessionId: session.id, userId: 'u' }).commands.length, 200);
  assert.equal(manager.close({ sessionId: session.id, userId: 'u' }), true);
  assert.equal(manager.close({ sessionId: session.id, userId: 'u' }), true);
});
