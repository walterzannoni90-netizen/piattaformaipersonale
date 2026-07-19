'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DOMAINS, MANDATORY_AGENTS, MandatorySeventyAgentRuntime } = require('../app/services/mandatorySeventyAgents');
const { createMandatorySeventyRuntime } = require('../app/services/mandatorySeventyFactory');

function completedHandlers() {
  return Object.fromEntries(MANDATORY_AGENTS.map((agent) => [agent.id, async () => ({ status: 'completed', output: agent.id })]));
}

test('catalogue contains exactly seventy unique mandatory agents', () => {
  assert.equal(Object.keys(DOMAINS).length, 10);
  assert.equal(MANDATORY_AGENTS.length, 70);
  assert.equal(new Set(MANDATORY_AGENTS.map((agent) => agent.id)).size, 70);
  assert.equal(MANDATORY_AGENTS.every((agent) => agent.mandatory), true);
});

test('runtime refuses execution when one mandatory agent is missing', async () => {
  const handlers = completedHandlers();
  delete handlers['product-readiness'];
  const runtime = new MandatorySeventyAgentRuntime({ handlers });
  assert.equal(runtime.health().registered, 69);
  await assert.rejects(runtime.execute({ runId: 'missing-agent' }), (error) => error.code === 'MANDATORY_70_NOT_READY');
});

test('runtime executes all seventy agents with exact accounting', async () => {
  const runtime = new MandatorySeventyAgentRuntime({ handlers: completedHandlers(), concurrency: 10 });
  const result = await runtime.execute({ runId: 'seventy-success' });
  assert.deepEqual(result.summary, { required: 70, completed: 70, failed: 0, blocked: 0, skipped: 0 });
  assert.equal(result.complete, true);
});

test('factory exposes a ready runtime with seventy explicit handlers', () => {
  const factory = createMandatorySeventyRuntime({ handlers: completedHandlers() });
  assert.deepEqual(factory.health(), { ready: true, required: 70, registered: 70, missing: [] });
});
