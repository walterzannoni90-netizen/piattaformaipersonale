'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  stableBucket,
  chooseRuntime,
  canFallbackToLegacy,
  routeTaskExecution
} = require('../app/services/runtimeCanaryRouter');

test('stable bucket is deterministic and bounded', () => {
  const first = stableBucket('task-123');
  const second = stableBucket('task-123');
  assert.equal(first, second);
  assert.ok(first >= 0 && first < 100);
});

test('legacy and durable modes bypass canary selection', () => {
  assert.equal(chooseRuntime({ id: 'a' }, { mode: 'legacy', canaryPercent: 100 }).runtime, 'legacy');
  assert.equal(chooseRuntime({ id: 'a' }, { mode: 'durable', canaryPercent: 0 }).runtime, 'durable');
});

test('canary routing is deterministic and respects eligibility', () => {
  const selected = chooseRuntime({ id: 'eligible' }, { mode: 'canary', canaryPercent: 100, isEligible: () => true });
  const excluded = chooseRuntime({ id: 'eligible' }, { mode: 'canary', canaryPercent: 100, isEligible: () => false });
  assert.equal(selected.runtime, 'durable');
  assert.equal(excluded.runtime, 'legacy');
  assert.equal(excluded.reason, 'task_not_eligible');
});

test('fallback is forbidden after irreversible progress or uncertain external action', () => {
  assert.equal(canFallbackToLegacy({ error: new Error('bootstrap'), durableStarted: false }), true);
  assert.equal(canFallbackToLegacy({ error: Object.assign(new Error('uncertain'), { code: 'EXTERNAL_ACTION_UNCERTAIN' }) }), false);
  assert.equal(canFallbackToLegacy({ error: new Error('later'), events: [{ type: 'delivery_claimed' }] }), false);
  assert.equal(canFallbackToLegacy({ error: Object.assign(new Error('cancel'), { code: 'TASK_CANCELLED' }) }), false);
});

test('router uses durable runtime when selected', async () => {
  const calls = [];
  const result = await routeTaskExecution({
    task: { id: 'task-durable' },
    mode: 'durable',
    legacyRunner: async () => calls.push('legacy'),
    durableRunner: async ({ recordEvent }) => {
      calls.push('durable');
      recordEvent({ type: 'execution_started' });
      return { status: 'completed' };
    }
  });
  assert.deepEqual(calls, ['durable']);
  assert.equal(result.status, 'completed');
});

test('router falls back only for durable bootstrap failures before execution', async () => {
  const calls = [];
  const result = await routeTaskExecution({
    task: { id: 'task-fallback' },
    mode: 'durable',
    legacyRunner: async ({ decision }) => {
      calls.push(`legacy:${decision.reason}`);
      return { status: 'completed', runtime: 'legacy' };
    },
    durableRunner: async () => {
      calls.push('durable');
      const error = new Error('coordinator unavailable');
      error.code = 'RUNTIME_BOOTSTRAP_FAILED';
      throw error;
    }
  });
  assert.deepEqual(calls, ['durable', 'legacy:durable_bootstrap_fallback']);
  assert.equal(result.runtime, 'legacy');
});

test('router never falls back after a delivery claim', async () => {
  await assert.rejects(() => routeTaskExecution({
    task: { id: 'task-no-fallback' },
    mode: 'durable',
    legacyRunner: async () => ({ status: 'completed' }),
    durableRunner: async ({ recordEvent }) => {
      recordEvent({ type: 'delivery_claimed' });
      throw new Error('late failure');
    }
  }), /late failure/);
});
