'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MANDATORY_AGENTS, MandatorySeventyAgentRuntime } = require('../app/services/mandatorySeventyAgents');

function handlers(factory = () => ({ status: 'completed' })) {
  return Object.fromEntries(MANDATORY_AGENTS.map((agent) => [agent.id, async (context) => factory(agent, context)]));
}

test('catalog remains exactly seventy unique mandatory agents', () => {
  assert.equal(MANDATORY_AGENTS.length, 70);
  assert.equal(new Set(MANDATORY_AGENTS.map((agent) => agent.id)).size, 70);
  assert.ok(MANDATORY_AGENTS.every((agent) => agent.mandatory));
});

test('executes all seventy agents successfully', async () => {
  const runtime = new MandatorySeventyAgentRuntime({ handlers: handlers(), concurrency: 14 });
  const result = await runtime.execute({ runId: 'all-success' });
  assert.equal(result.complete, true);
  assert.deepEqual(result.summary, { required: 70, completed: 70, failed: 0, blocked: 0, skipped: 0 });
});

test('retries transient failures and eventually succeeds', async () => {
  const attempts = new Map();
  const runtime = new MandatorySeventyAgentRuntime({
    handlers: handlers((agent) => {
      const count = (attempts.get(agent.id) || 0) + 1;
      attempts.set(agent.id, count);
      if (count === 1) throw new Error('transient');
      return { status: 'completed', output: count };
    }),
    retries: 1,
    retryDelayMs: 0,
    concurrency: 20
  });
  const result = await runtime.execute({ runId: 'retry-success' });
  assert.equal(result.complete, true);
  assert.ok([...attempts.values()].every((count) => count === 2));
});

test('marks timed out agents as failed', async () => {
  const runtime = new MandatorySeventyAgentRuntime({
    handlers: handlers((agent) => agent.id === MANDATORY_AGENTS[0].id ? new Promise(() => {}) : { status: 'completed' }),
    timeoutMs: 5,
    retries: 0,
    concurrency: 70
  });
  const result = await runtime.execute({ runId: 'timeout' });
  assert.equal(result.complete, false);
  assert.equal(result.summary.failed, 1);
  assert.equal(result.agents[0].code, 'MANDATORY_AGENT_TIMEOUT');
});

test('resumes completed agents from checkpoint without re-executing them', async () => {
  const called = [];
  const completed = MANDATORY_AGENTS.slice(0, 10).map((agent) => ({ agentId: agent.id, domain: agent.domain, status: 'completed' }));
  const checkpointStore = { load: async () => ({ results: completed }), save: async () => {} };
  const runtime = new MandatorySeventyAgentRuntime({
    handlers: handlers((agent) => { called.push(agent.id); return { status: 'completed' }; }),
    checkpointStore,
    concurrency: 10
  });
  const result = await runtime.execute({ runId: 'resume' });
  assert.equal(result.complete, true);
  assert.equal(called.length, 60);
  assert.ok(completed.every((item) => !called.includes(item.agentId)));
});

test('1000 deterministic executions preserve exact accounting invariants', async () => {
  for (let seed = 0; seed < 1000; seed += 1) {
    const failIndex = seed % 71;
    const blockIndex = (seed * 7) % 71;
    const runtime = new MandatorySeventyAgentRuntime({
      handlers: handlers((agent) => {
        const index = MANDATORY_AGENTS.findIndex((candidate) => candidate.id === agent.id);
        if (failIndex < 70 && index === failIndex) return { status: 'failed' };
        if (blockIndex < 70 && index === blockIndex && blockIndex !== failIndex) return { status: 'blocked' };
        return { status: 'completed' };
      }),
      concurrency: (seed % 70) + 1,
      retries: 0
    });
    const result = await runtime.execute({ runId: `seed-${seed}` });
    const total = result.summary.completed + result.summary.failed + result.summary.blocked + result.summary.skipped;
    assert.equal(total, 70);
    assert.equal(result.complete, result.summary.completed === 70);
    assert.equal(result.agents.length, 70);
  }
});
