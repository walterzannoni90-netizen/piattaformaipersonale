'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ADVANCED_TRACKS, AdvancedTenAgentProgram } = require('../app/services/advancedTenAgentProgram');
const { createAdvancedAutonomyFactory } = require('../app/services/advancedAutonomyFactory');

function completedHandlers() {
  return Object.fromEntries(
    ADVANCED_TRACKS.map((track) => [track.id, async () => ({ status: 'completed', output: track.id })])
  );
}

test('advanced ten-agent program contracts', async () => {
  assert.equal(ADVANCED_TRACKS.length, 10);
  assert.equal(new Set(ADVANCED_TRACKS.map((track) => track.id)).size, 10);
  assert.equal(new Set(ADVANCED_TRACKS.map((track) => track.owner)).size, 10);

  const successfulProgram = new AdvancedTenAgentProgram({ handlers: completedHandlers(), concurrency: 1 });
  const successfulResult = await successfulProgram.run({
    goal: 'production advancement',
    runId: 'ci-success-run'
  });
  assert.deepEqual(successfulResult.summary, {
    requested: 10,
    completed: 10,
    failed: 0,
    partial: 0
  });
  assert.equal(successfulResult.complete, true);

  const failingHandlers = completedHandlers();
  failingHandlers['continuous-evaluation'] = async () => ({
    status: 'failed',
    output: { regression: true }
  });
  const failedResult = await new AdvancedTenAgentProgram({
    handlers: failingHandlers,
    concurrency: 1
  }).run({ runId: 'ci-failure-run' });
  assert.equal(failedResult.summary.completed, 9);
  assert.equal(failedResult.summary.failed, 1);
  assert.equal(failedResult.complete, false);

  const factory = createAdvancedAutonomyFactory({});
  assert.deepEqual(factory.health(), { ready: true, agents: 10, registered: 10 });
});
