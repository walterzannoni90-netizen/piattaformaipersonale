'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolRegistry } = require('../app/services/toolRegistry');
const { VerifiedToolRuntime } = require('../app/services/verifiedToolRuntime');

test('default verifier rejects explicit unsuccessful tool results', async () => {
  const registry = new ToolRegistry();
  registry.register({ id: 'test.result', risk: 'read', actions: ['run'], plans: ['pro'], agentRoles: ['orchestrator'] });
  const runtime = new VerifiedToolRuntime({ registry, handlers: { 'test.result': async () => ({ success: false }) } });
  await assert.rejects(
    runtime.execute({ toolId: 'test.result', action: 'run', plan: 'pro', agentRole: 'orchestrator' }),
    (error) => error.code === 'VERIFICATION_FAILED'
  );
});
