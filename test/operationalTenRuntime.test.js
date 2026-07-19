'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OPERATIONAL_TRACKS, OperationalTenRuntime } = require('../app/services/operationalTenRuntime');
const { runUnifiedTaskRuntime } = require('../app/services/unifiedTaskRuntime');
const { ADVANCED_TRACKS, AdvancedTenAgentProgram } = require('../app/services/advancedTenAgentProgram');
const { createAdvancedAutonomyFactory } = require('../app/services/advancedAutonomyFactory');

function handlers(status = 'completed') {
  return Object.fromEntries(OPERATIONAL_TRACKS.map((track) => [track, async () => ({ status, output: track })]));
}

function advancedHandlers() {
  return Object.fromEntries(
    ADVANCED_TRACKS.map((track) => [track.id, async () => ({ status: 'completed', output: track.id })])
  );
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

test('advanced ten-agent contracts remain covered by the stable operational suite', async () => {
  assert.equal(ADVANCED_TRACKS.length, 10);
  assert.equal(new Set(ADVANCED_TRACKS.map((track) => track.id)).size, 10);
  assert.equal(new Set(ADVANCED_TRACKS.map((track) => track.owner)).size, 10);

  const success = await new AdvancedTenAgentProgram({
    handlers: advancedHandlers(),
    concurrency: 1
  }).run({ runId: 'advanced-success' });
  assert.deepEqual(success.summary, { requested: 10, completed: 10, failed: 0, partial: 0 });
  assert.equal(success.complete, true);

  const failing = advancedHandlers();
  failing['continuous-evaluation'] = async () => ({ status: 'failed', output: { regression: true } });
  const failed = await new AdvancedTenAgentProgram({ handlers: failing, concurrency: 1 }).run({ runId: 'advanced-failure' });
  assert.equal(failed.summary.completed, 9);
  assert.equal(failed.summary.failed, 1);
  assert.equal(failed.complete, false);

  assert.deepEqual(createAdvancedAutonomyFactory({}).health(), { ready: true, agents: 10, registered: 10 });
});
