'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolRegistry } = require('../app/services/toolRegistry');
const { VerifiedToolRuntime } = require('../app/services/verifiedToolRuntime');

test('rejects oversized serialized tool output', async () => {
  const registry = new ToolRegistry();
  registry.register({ id: 'test.large', risk: 'read', actions: ['run'], plans: ['pro'], agentRoles: ['orchestrator'] });
  const runtime = new VerifiedToolRuntime({
    registry,
    maxOutputBytes: 1024,
    handlers: { 'test.large': async () => ({ data: 'x'.repeat(2048) }) }
  });
  await assert.rejects(
    runtime.execute({ toolId: 'test.large', action: 'run', plan: 'pro', agentRole: 'orchestrator' }),
    (error) => error.code === 'OUTPUT_LIMIT'
  );
});
