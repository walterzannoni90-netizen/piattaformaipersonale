'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CAPABILITY_TRACKS, ParallelCapabilityProgram } = require('../app/services/parallelCapabilityProgram');
const { createCapabilityAdapters, cosine } = require('../app/services/autonomousCapabilityAdapters');

test('defines exactly sixteen remaining capability owners', () => {
  assert.equal(CAPABILITY_TRACKS.length, 16);
  assert.equal(new Set(CAPABILITY_TRACKS.map((track) => track.owner)).size, 16);
  assert.equal(new Set(CAPABILITY_TRACKS.map((track) => track.id)).size, 16);
});

test('runs all sixteen tracks concurrently through registered adapters', async () => {
  const events = [];
  const adapters = Object.fromEntries(CAPABILITY_TRACKS.map((track) => [track.id, async () => ({ output: track.id })]));
  const program = new ParallelCapabilityProgram({
    handlers: adapters,
    concurrency: 16,
    telemetry: { record: async (event) => events.push(event) }
  });
  const result = await program.run({ goal: 'complete roadmap' });
  assert.equal(result.summary.requested, 16);
  assert.equal(result.summary.completed, 16);
  assert.equal(result.complete, true);
  assert.equal(result.tracks.length, 16);
  assert.ok(events.some((event) => event.type === 'program.completed'));
});

test('capability adapters provide working semantic ranking and optimizer', async () => {
  const adapters = createCapabilityAdapters({
    memory: { list: async () => [{ id: 'a', embedding: [1, 0] }, { id: 'b', embedding: [0, 1] }], appendEvent: async () => {} }
  });
  const semantic = await adapters['semantic-memory']({ query: 'x', embedding: [1, 0] });
  assert.equal(semantic.output.matches[0].id, 'a');
  const optimized = await adapters['cost-time-token-optimization']({
    candidates: [{ id: 'cheap', quality: 8, cost: 1, latencyMs: 100, tokens: 100 }, { id: 'expensive', quality: 9, cost: 20, latencyMs: 100, tokens: 100 }],
    limits: { cost: 10 }
  });
  assert.equal(optimized.output.selected.id, 'cheap');
  assert.equal(cosine([1, 0], [1, 0]), 1);
});

test('sandbox adapter executes isolated expressions', async () => {
  const adapters = createCapabilityAdapters();
  const result = await adapters['isolated-sandbox']({ source: '() => 6 * 7' });
  assert.equal(result.output(), 42);
});
