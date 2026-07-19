'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ProductionAutonomyRuntime, WORKSTREAMS } = require('../app/services/productionAutonomyRuntime');
const { RuntimeOptimizer, ObservabilityStore, createAutomaticReplanner } = require('../app/services/productionCapabilitySuite');

test('production runtime exposes twelve workstreams', () => {
  assert.equal(WORKSTREAMS.length, 12);
  const runtime = new ProductionAutonomyRuntime();
  assert.equal(runtime.health().workstreams, 12);
  assert.equal(runtime.health().concurrency, 12);
});

test('optimizer respects hard budgets', () => {
  const optimizer = new RuntimeOptimizer();
  const selected = optimizer.select({ candidates: [
    { id:'expensive', quality:10, cost:100, tokens:100, latencyMs:10 },
    { id:'balanced', quality:8, cost:2, tokens:500, latencyMs:100 }
  ], budget: { cost:5, tokens:1000, latencyMs:1000 } });
  assert.equal(selected.id, 'balanced');
});

test('observability snapshot reports failures', async () => {
  const telemetry = new ObservabilityStore();
  await telemetry.record({ type:'track.completed' });
  await telemetry.record({ type:'track.failed' });
  const snapshot = telemetry.snapshot();
  assert.equal(snapshot.events, 2);
  assert.equal(snapshot.failed, 1);
  assert.equal(snapshot.health, 'degraded');
});

test('automatic replanner stops after verified plan', async () => {
  let calls = 0;
  const replan = createAutomaticReplanner({
    planner: async () => ({ version: ++calls }),
    verifier: async ({ plan }) => ({ passed: plan.version === 2 }),
    maxRounds: 3
  });
  const result = await replan({ goal:'ship', plan:{}, failure:{} });
  assert.equal(result.rounds, 2);
  assert.equal(result.verification.passed, true);
});
