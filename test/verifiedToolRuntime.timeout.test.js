'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolRegistry } = require('../app/services/toolRegistry');
const { VerifiedToolRuntime } = require('../app/services/verifiedToolRuntime');

test('enforces execution timeout and releases the in-flight slot', async () => {
  const registry = new ToolRegistry();
  registry.register({
    id: 'test.slow',
    risk: 'read',
    actions: ['run'],
    plans: ['pro'],
    agentRoles: ['orchestrator']
  });
  const runtime = new VerifiedToolRuntime({
    registry,
    defaultTimeoutMs: 100,
    handlers: { 'test.slow': async () => new Promise(() => {}) }
  });
  const request = {
    toolId: 'test.slow',
    action: 'run',
    plan: 'pro',
    agentRole: 'orchestrator',
    executionId: 'slow-run'
  };
  await assert.rejects(runtime.execute(request), (error) => error.code === 'TOOL_TIMEOUT');
  assert.equal(runtime.inflight.has('slow-run'), false);
});
