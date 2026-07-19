'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  SemanticMemory,
  ToolSelector,
  createHierarchicalPlan,
  AgentPool,
  BrowserRecoveryController,
  evaluateQuality,
  DistributedTaskQueue,
  runMultiAgentTask,
  runAgentBenchmark
} = require('../app/services/manusRuntimeWave2');

test('semantic memory ranks relevant memories', async () => {
  const memory = new SemanticMemory();
  await memory.remember({ scope: 'task', text: 'analisi prezzi concorrenti italiani' });
  await memory.remember({ scope: 'task', text: 'ricetta della pizza' });
  const recalled = await memory.recall('prezzi concorrenti', { scope: 'task' });
  assert.equal(recalled[0].text, 'analisi prezzi concorrenti italiani');
  assert.ok(recalled[0].score > 0);
});

test('tool selector prefers capable reliable low-cost tool', () => {
  const selector = new ToolSelector([
    { name: 'slow', capabilities: ['browser'], reliability: 0.9, cost: 5 },
    { name: 'fast', capabilities: ['browser'], reliability: 0.85, cost: 1 }
  ]);
  assert.equal(selector.select({ action: 'browser', capabilities: ['browser'] }).name, 'fast');
});

test('hierarchical planner links phases and assigns roles', () => {
  const graph = createHierarchicalPlan('crea report', [
    { id: 'research', agentRole: 'researcher', steps: [{ id: 'search', action: 'web' }] },
    { id: 'write', agentRole: 'writer', steps: [{ id: 'draft', action: 'write' }] }
  ]);
  assert.equal(graph.nodes[0].agentRole, 'researcher');
  assert.deepEqual(graph.nodes[1].dependencies, ['search']);
});

test('agent pool balances load and updates reliability', () => {
  const pool = new AgentPool([
    { id: 'a', roles: ['researcher'], reliability: 0.9 },
    { id: 'b', roles: ['researcher'], reliability: 0.8 }
  ]);
  const first = pool.acquire('researcher');
  const second = pool.acquire('researcher');
  assert.notEqual(first.id, second.id);
  pool.release(first, false);
  assert.ok(first.reliability < 0.9);
});

test('browser controller recovers transient failures', async () => {
  let attempts = 0;
  let recoveries = 0;
  const controller = new BrowserRecoveryController({ maxRecoveries: 2 });
  const result = await controller.run(async () => {
    attempts += 1;
    if (attempts < 2) throw Object.assign(new Error('crash'), { code: 'BROWSER_CRASH' });
    return 'ok';
  }, { browser: { recover: async () => { recoveries += 1; } } });
  assert.equal(result, 'ok');
  assert.equal(recoveries, 1);
});

test('quality evaluator blocks placeholders and enforces rubric', () => {
  assert.equal(evaluateQuality('TODO', { minLength: 2 }).passed, false);
  assert.equal(evaluateQuality('report completo prezzi', { minLength: 10, requiredTerms: ['prezzi'] }).passed, true);
});

test('distributed queue leases, retries and completes jobs', () => {
  const queue = new DistributedTaskQueue({ leaseMs: 10 });
  const low = queue.enqueue({ name: 'low' }, { priority: 1 });
  const high = queue.enqueue({ name: 'high' }, { priority: 10 });
  const claimed = queue.claim('worker-1');
  assert.equal(claimed.id, high);
  queue.fail(high, new Error('temporary'));
  assert.equal(queue.claim('worker-2').id, high);
  queue.complete(high, 'done');
  assert.equal(queue.jobs.get(high).status, 'completed');
  assert.equal(queue.jobs.get(low).status, 'queued');
});

test('multi-agent runtime executes plan with tools, memory and quality gates', async () => {
  const events = [];
  const result = await runMultiAgentTask({
    goal: 'analizza mercato e crea report',
    outline: [
      { id: 'research', agentRole: 'researcher', steps: [{ id: 'collect', title: 'raccogli prezzi', action: 'web', capabilities: ['browser'] }] },
      { id: 'report', agentRole: 'writer', steps: [{ id: 'write', title: 'scrivi report', action: 'write', capabilities: ['documents'] }] }
    ],
    agents: [
      { id: 'research-agent', roles: ['researcher'] },
      { id: 'writer-agent', roles: ['writer'] }
    ],
    tools: [
      { name: 'browser-tool', capabilities: ['browser', 'web'], reliability: 0.95 },
      { name: 'document-tool', capabilities: ['documents', 'write'], reliability: 0.95 }
    ],
    handlers: {
      'browser-tool': async () => 'prezzi concorrenti raccolti e verificati',
      'document-tool': async ({ memory }) => `report completo prezzi con ${memory.length} memoria`
    },
    browser: { recover: async () => {} },
    qualityRubric: {
      web: { requiredTerms: ['prezzi'], minLength: 10 },
      write: { requiredTerms: ['report', 'prezzi'], minLength: 10 }
    },
    onEvent: (event) => events.push(event)
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.progress, 1);
  assert.equal(result.agentMetrics.every((agent) => agent.load === 0), true);
  assert.ok(events.some((event) => event.type === 'step_completed'));
});

test('benchmark reports pass rate and failed cases', async () => {
  const report = await runAgentBenchmark([
    { id: 'good', rubric: { requiredTerms: ['done'] } },
    { id: 'bad', rubric: { requiredTerms: ['missing'] } }
  ], async (item) => item.id === 'good' ? 'done correctly' : 'wrong');
  assert.equal(report.total, 2);
  assert.equal(report.passed, 1);
  assert.equal(report.passRate, 0.5);
});
