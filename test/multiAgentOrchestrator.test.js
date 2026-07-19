'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { MultiAgentOrchestrator } = require('../app/services/multiAgentOrchestrator');

function build({ verifierPasses = true, criticApproves = true } = {}) {
  const events = [];
  const agents = {
    planner: async (context) => ({ steps: ['execute'], replanned: context.task?.replan === true }),
    executor: async () => ({ output: 'done', toolTasks: [{ id: 'task-1', action: 'search', requiredCapabilities: ['web_search'], payload: { q: 'x' } }] }),
    critic: async () => ({ approved: criticApproves, issues: criticApproves ? [] : ['weak evidence'] }),
    verifier: async () => ({ passed: verifierPasses, score: verifierPasses ? 1 : 0.2 })
  };
  const router = { select: async () => ({ toolId: 'fast.search', score: 0.9, ranking: [] }) };
  const runtime = { execute: async () => ({ executionId: 'exec-1', result: { ok: true }, resultHash: 'hash' }) };
  const memory = { appendEvent: async (key, event) => events.push({ key, event }) };
  return { orchestrator: new MultiAgentOrchestrator({ agents, router, runtime, memory, maxRounds: 2 }), events };
}

test('coordinates planner executor critic and verifier', async () => {
  const { orchestrator, events } = build();
  const result = await orchestrator.run({ goal: 'research market', plan: 'pro', runId: 'run-1' });
  assert.equal(result.status, 'completed');
  assert.equal(result.rounds, 1);
  assert.equal(result.execution.toolExecutions[0].selection.toolId, 'fast.search');
  assert.deepEqual(result.history.map((item) => item.role), ['planner', 'executor', 'critic', 'verifier']);
  assert.equal(events.at(-1).event.type, 'multi_agent_completed');
});

test('replans when verification fails and stops after maximum rounds', async () => {
  const { orchestrator, events } = build({ verifierPasses: false });
  await assert.rejects(
    orchestrator.run({ goal: 'hard task', plan: 'pro', runId: 'run-2' }),
    (error) => error.code === 'MULTI_AGENT_VERIFICATION_FAILED' && error.history.some((item) => item.status === 'replanned')
  );
  assert.equal(events.at(-1).event.type, 'multi_agent_failed');
});

test('requires all configured agent roles', async () => {
  const orchestrator = new MultiAgentOrchestrator({ agents: {}, router: {}, runtime: {} });
  await assert.rejects(orchestrator.run({ goal: 'x', plan: 'pro' }), (error) => error.code === 'AGENT_MISSING');
});
