'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolRegistry } = require('../app/services/toolRegistry');
const { VerifiedToolRuntime } = require('../app/services/verifiedToolRuntime');

function registry() {
  const value = new ToolRegistry();
  value.register({
    id: 'test.reader',
    title: 'Test reader',
    risk: 'read',
    actions: ['read'],
    plans: ['pro'],
    agentRoles: ['orchestrator']
  });
  return value;
}

const request = {
  toolId: 'test.reader',
  action: 'read',
  plan: 'pro',
  agentRole: 'orchestrator'
};

test('executes an authorized tool and verifies its result', async () => {
  const runtime = new VerifiedToolRuntime({
    registry: registry(),
    handlers: { 'test.reader': async () => ({ value: 42 }) },
    verifier: ({ result }) => ({ passed: result.value === 42, score: 1 })
  });

  const execution = await runtime.execute({ ...request, executionId: 'verified-1' });
  assert.equal(execution.status, 'completed');
  assert.equal(execution.result.value, 42);
  assert.equal(execution.verification.passed, true);
  assert.match(execution.resultHash, /^[a-f0-9]{64}$/);
});

test('rejects unauthorized operations before invoking a handler', async () => {
  let invoked = false;
  const runtime = new VerifiedToolRuntime({
    registry: registry(),
    handlers: { 'test.reader': async () => { invoked = true; } }
  });

  await assert.rejects(
    runtime.execute({ ...request, action: 'write' }),
    (error) => error.code === 'action_not_allowed'
  );
  assert.equal(invoked, false);
});

test('rejects results that fail automatic verification', async () => {
  const runtime = new VerifiedToolRuntime({
    registry: registry(),
    handlers: { 'test.reader': async () => ({ complete: false }) },
    verifier: () => ({ passed: false, reason: 'Incomplete output', score: 0.2 })
  });

  await assert.rejects(
    runtime.execute({ ...request, executionId: 'verified-2' }),
    (error) => error.code === 'VERIFICATION_FAILED' && error.verification.score === 0.2
  );
});

test('prevents duplicate in-flight execution identifiers', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const runtime = new VerifiedToolRuntime({
    registry: registry(),
    handlers: { 'test.reader': async () => gate }
  });

  const first = runtime.execute({ ...request, executionId: 'same-id' });
  await assert.rejects(
    runtime.execute({ ...request, executionId: 'same-id' }),
    (error) => error.code === 'DUPLICATE_EXECUTION'
  );
  release({ ok: true });
  await first;
});
