'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildExecutionGraph,
  selectReadyNodes,
  createCheckpoint,
  restoreCheckpoint,
  classifyFailure,
  computeRetryDelay,
  evaluateCompletion,
  executeGraph
} = require('../app/services/autonomousExecutionKernel');

test('builds a deterministic dependency graph', () => {
  const graph = buildExecutionGraph('Research and report', [
    { id: 'research', action: 'web' },
    { id: 'report', action: 'write', dependencies: ['research'] }
  ]);
  assert.equal(graph.nodes.length, 2);
  assert.deepEqual(selectReadyNodes(graph).map((node) => node.id), ['research']);
});

test('rejects unknown dependencies', () => {
  assert.throws(() => buildExecutionGraph('x', [{ id: 'a', dependencies: ['missing'] }]), /Dipendenza sconosciuta/);
});

test('checkpoint roundtrip detects corruption', () => {
  const graph = buildExecutionGraph('x', [{ id: 'a' }]);
  const checkpoint = createCheckpoint(graph);
  assert.deepEqual(restoreCheckpoint(checkpoint), graph);
  checkpoint.graph.goal = 'tampered';
  assert.throws(() => restoreCheckpoint(checkpoint), /corrotto/);
});

test('classifies failures and computes bounded backoff', () => {
  assert.equal(classifyFailure({ code: 'RATE_LIMIT' }), 'transient');
  assert.equal(classifyFailure({ code: 'AUTH_REQUIRED' }), 'blocked');
  assert.equal(classifyFailure({ code: 'BAD_INPUT' }), 'permanent');
  assert.equal(computeRetryDelay(1), 500);
  assert.equal(computeRetryDelay(20), 30000);
});

test('executes independent work in parallel and unlocks dependencies', async () => {
  const graph = buildExecutionGraph('complete job', [
    { id: 'a', action: 'work' },
    { id: 'b', action: 'work' },
    { id: 'c', action: 'finish', dependencies: ['a', 'b'] }
  ]);
  const events = [];
  let checkpoints = 0;
  const result = await executeGraph({
    graph,
    concurrency: 2,
    handlers: {
      work: async ({ node }) => ({ value: node.id }),
      finish: async () => ({ deliverable: 'done' })
    },
    checkpoint: async () => { checkpoints += 1; },
    onEvent: async (event) => events.push(event.type)
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.progress, 1);
  assert.equal(checkpoints, 2);
  assert.equal(events.filter((type) => type === 'step_completed').length, 3);
});

test('retries transient failures and blocks human-required actions', async () => {
  let attempts = 0;
  const retryGraph = buildExecutionGraph('retry', [{ id: 'a', action: 'unstable', maxAttempts: 2 }]);
  const retryResult = await executeGraph({
    graph: retryGraph,
    handlers: {
      unstable: async () => {
        attempts += 1;
        if (attempts === 1) throw Object.assign(new Error('slow'), { code: 'ETIMEDOUT' });
        return 'ok';
      }
    }
  });
  assert.equal(retryResult.status, 'completed');
  assert.equal(attempts, 2);

  const blockedGraph = buildExecutionGraph('login', [{ id: 'login', action: 'auth' }]);
  const blockedResult = await executeGraph({
    graph: blockedGraph,
    handlers: { auth: async () => { throw Object.assign(new Error('login'), { code: 'AUTH_REQUIRED' }); } }
  });
  assert.equal(blockedResult.status, 'blocked');
  assert.deepEqual(evaluateCompletion(blockedGraph).blocked, ['login']);
});
