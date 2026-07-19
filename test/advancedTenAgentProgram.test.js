'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ADVANCED_TRACKS, AdvancedTenAgentProgram } = require('../app/services/advancedTenAgentProgram');
const { createAdvancedAutonomyFactory } = require('../app/services/advancedAutonomyFactory');

function completedHandlers() {
  return Object.fromEntries(
    ADVANCED_TRACKS.map((track) => [track.id, () => Promise.resolve({ status: 'completed', output: track.id })])
  );
}

test('advanced ten-agent program contracts', async (t) => {
  await t.test('defines exactly ten isolated advanced agents', () => {
    assert.equal(ADVANCED_TRACKS.length, 10);
    assert.equal(new Set(ADVANCED_TRACKS.map((track) => track.id)).size, 10);
    assert.equal(new Set(ADVANCED_TRACKS.map((track) => track.owner)).size, 10);
  });

  await t.test('runs all ten agents and reports exact completion', async () => {
    const program = new AdvancedTenAgentProgram({ handlers: completedHandlers(), concurrency: 1 });
    const result = await program.run({ goal: 'production advancement', runId: 'ci-success-run' });
    assert.equal(result.summary.requested, 10);
    assert.equal(result.summary.completed, 10);
    assert.equal(result.summary.failed, 0);
    assert.equal(result.summary.partial, 0);
    assert.equal(result.complete, true);
  });

  await t.test('reports one failed agent deterministically', async () => {
    const handlers = completedHandlers();
    handlers['continuous-evaluation'] = () => Promise.resolve({ status: 'failed', output: { regression: true } });
    const result = await new AdvancedTenAgentProgram({ handlers, concurrency: 1 }).run({ runId: 'ci-failure-run' });
    assert.equal(result.summary.completed, 9);
    assert.equal(result.summary.failed, 1);
    assert.equal(result.complete, false);
  });

  await t.test('factory registers all ten operational contracts', () => {
    const factory = createAdvancedAutonomyFactory({});
    assert.deepEqual(factory.health(), { ready: true, agents: 10, registered: 10 });
  });
});
