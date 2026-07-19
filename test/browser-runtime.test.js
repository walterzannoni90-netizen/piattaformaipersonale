'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BrowserRuntime } = require('../app/services/browserRuntime');

function fakeDriver() {
  const calls = [];
  return {
    calls,
    async execute(payload) {
      calls.push(payload);
      return { ok: true, artifactId: payload.command.action === 'screenshot' ? 'artifact-1' : null };
    }
  };
}

test('read browser actions execute without approval for authorized plans and roles', async () => {
  const driver = fakeDriver();
  const runtime = new BrowserRuntime({ driver });
  const session = runtime.createSession({ userId: 'user-1', taskId: 'task-1' });
  const output = await runtime.execute({
    sessionId: session.id,
    userId: 'user-1',
    taskId: 'task-1',
    plan: 'pro',
    agentRole: 'scout',
    command: { action: 'screenshot' }
  });
  assert.equal(output.result.ok, true);
  assert.equal(driver.calls.length, 1);
});

test('write browser actions require the exact command approval hash', async () => {
  const runtime = new BrowserRuntime({ driver: fakeDriver() });
  const session = runtime.createSession({ userId: 'user-1', taskId: 'task-1' });
  const request = {
    sessionId: session.id,
    userId: 'user-1',
    taskId: 'task-1',
    plan: 'pro',
    agentRole: 'operator',
    command: { action: 'submit', selector: '#confirm', value: 'yes' }
  };
  let approvalHash;
  await assert.rejects(runtime.execute(request), (error) => {
    assert.equal(error.code, 'approval_required');
    approvalHash = error.approvalHash;
    return true;
  });
  await assert.rejects(runtime.execute({ ...request, approvedPayloadHash: 'wrong' }), (error) => error.code === 'approval_hash_mismatch');
  const output = await runtime.execute({ ...request, approvedPayloadHash: approvalHash });
  assert.equal(output.result.ok, true);
});

test('starter plan and cross-tenant sessions are denied', async () => {
  const runtime = new BrowserRuntime({ driver: fakeDriver() });
  const session = runtime.createSession({ userId: 'owner', taskId: 'task-1' });
  await assert.rejects(runtime.execute({
    sessionId: session.id,
    userId: 'owner',
    taskId: 'task-1',
    plan: 'starter',
    agentRole: 'scout',
    command: { action: 'screenshot' }
  }), (error) => error.code === 'plan_not_allowed');
  await assert.rejects(runtime.execute({
    sessionId: session.id,
    userId: 'other',
    taskId: 'task-1',
    plan: 'pro',
    agentRole: 'scout',
    command: { action: 'screenshot' }
  }), /Sessione browser non disponibile/);
});

test('driver failures are recorded and normalized', async () => {
  const runtime = new BrowserRuntime({
    driver: { async execute() { throw new Error('page crashed'); } }
  });
  const session = runtime.createSession({ userId: 'user-1', taskId: 'task-1' });
  await assert.rejects(runtime.execute({
    sessionId: session.id,
    userId: 'user-1',
    taskId: 'task-1',
    plan: 'enterprise',
    agentRole: 'orchestrator',
    command: { action: 'navigate', url: 'https://example.com' }
  }), (error) => error.code === 'browser_execution_failed');
  const stored = runtime.sessions.get({ sessionId: session.id, userId: 'user-1' });
  assert.equal(stored.commands[0].status, 'failed');
});
