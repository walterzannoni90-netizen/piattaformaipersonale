'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ADVANCED_TRACKS, AdvancedTenAgentProgram } = require('../app/services/advancedTenAgentProgram');
const { createAdvancedAutonomyFactory } = require('../app/services/advancedAutonomyFactory');

test('defines exactly ten isolated advanced agents', () => {
  assert.equal(ADVANCED_TRACKS.length, 10);
  assert.equal(new Set(ADVANCED_TRACKS.map((track) => track.id)).size, 10);
  assert.equal(new Set(ADVANCED_TRACKS.map((track) => track.owner)).size, 10);
});

test('runs all ten agents and reports exact completion', async () => {
  const handlers = Object.fromEntries(
    ADVANCED_TRACKS.map((track) => [track.id, async () => ({ output: track.id })])
  );
  const program = new AdvancedTenAgentProgram({ handlers, concurrency: 10 });
  const result = await program.run({ goal: 'production advancement' });
  assert.equal(result.summary.requested, 10);
  assert.equal(result.summary.completed, 10);
  assert.equal(result.summary.failed, 0);
  assert.equal(result.complete, true);
});

test('reports an explicit failed agent deterministically', async () => {
  const handlers = Object.fromEntries(
    ADVANCED_TRACKS.map((track) => [
      track.id,
      async () => track.id === 'continuous-evaluation'
        ? { status: 'failed', output: { regression: true } }
        : { output: track.id }
    ])
  );
  const result = await new AdvancedTenAgentProgram({ handlers }).run({});
  assert.equal(result.summary.completed, 9);
  assert.equal(result.summary.failed, 1);
  assert.equal(result.complete, false);
});

test('factory registers all ten operational contracts', () => {
  const factory = createAdvancedAutonomyFactory({});
  assert.deepEqual(factory.health(), { ready: true, agents: 10, registered: 10 });
});
