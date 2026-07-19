'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OPERATIONAL_TRACKS, OperationalTenRuntime } = require('../app/services/operationalTenRuntime');
const { runUnifiedTaskRuntime } = require('../app/services/unifiedTaskRuntime');

function handlers(status = 'completed') {
  return Object.fromEntries(OPERATIONAL_TRACKS.map((track) => [track, async () => ({ status, output: track })]));
}

test('operational runtime exposes ten required tracks', () => {
  assert.equal(OPERATIONAL_TRACKS.length, 10);
  assert.equal(new Set(OPERATIONAL_TRACKS).size, 10);
  assert.deepEqual(new OperationalTenRuntime({ handlers: handlers() }).health(), { ready: true, registered: 10, required: 10 });
});

test('operational runtime executes all tracks with exact accounting', async () => {
  const runtime = new OperationalTenRuntime({ handlers: handlers(), concurrency: 1 });
  const result = await runtime.execute({ runId: 'operational-test' });
  assert.equal(result.summary.completed, 10);
  assert.equal(result.summary.failed, 0);
  assert.equal(result.summary.blocked, 0);
  assert.equal(result.complete, true);
});

test('unified runtime rejects an incomplete operational runtime', async () => {
  const runtime = new OperationalTenRuntime({ handlers: {} });
  await assert.rejects(
    runUnifiedTaskRuntime({ task: { id: 'task-1' }, operationalRuntime: runtime }),
    (error) => error.code === 'OPERATIONAL_RUNTIME_NOT_READY'
  );
});

test('unified runtime delegates to a ready operational runtime', async () => {
  const runtime = new OperationalTenRuntime({ handlers: handlers(), concurrency: 1 });
  const result = await runUnifiedTaskRuntime({ task: { id: 'task-2', goal: 'ship safely' }, operationalRuntime: runtime });
  assert.equal(result.complete, true);
});
