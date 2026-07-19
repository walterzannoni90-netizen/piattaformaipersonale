'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const gateway = require('../app/services/openManusGateway');

function withEnv(values, fn) {
  const previous = {};
  for (const [key, value] of Object.entries(values)) {
    previous[key] = process.env[key];
    if (value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test.beforeEach(() => gateway.resetForTests());

test('runtime is disabled by default', () => withEnv({ OPENMANUS_RUNTIME_MODE: undefined }, () => {
  assert.equal(gateway.shouldDelegate({ taskId: 'task-1' }), false);
}));

test('primary and shadow modes delegate', () => withEnv({ OPENMANUS_RUNTIME_MODE: 'primary' }, () => {
  assert.equal(gateway.shouldDelegate({ taskId: 'task-1' }), true);
}));

test('canary routing is stable and excludes team mode', () => withEnv({
  OPENMANUS_RUNTIME_MODE: 'canary',
  OPENMANUS_CANARY_PERCENT: '100'
}, () => {
  assert.equal(gateway.shouldDelegate({ taskId: 'task-1', mode: 'autonomous' }), true);
  assert.equal(gateway.shouldDelegate({ taskId: 'task-1', mode: 'team' }), false);
  assert.equal(gateway.stableBucket('task-1'), gateway.stableBucket('task-1'));
}));

test('idempotency keys are deterministic and task-specific', () => {
  const first = gateway.idempotencyKey({ taskId: 'a', userId: 'u', prompt: 'hello world' });
  const same = gateway.idempotencyKey({ taskId: 'a', userId: 'u', prompt: 'hello world' });
  const other = gateway.idempotencyKey({ taskId: 'b', userId: 'u', prompt: 'hello world' });
  assert.equal(first, same);
  assert.notEqual(first, other);
  assert.equal(first.length, 64);
});

test('progress is normalized for all terminal states', () => {
  assert.deepEqual(gateway.normalizeProgress({ id: '1', status: 'completed' }), {
    id: '1', status: 'completed', progress: 100, terminal: true, error: null, updatedAt: null
  });
  assert.equal(gateway.normalizeProgress({ status: 'running' }).terminal, false);
  assert.equal(gateway.normalizeProgress({ status: 'cancelled' }).progress, 100);
});

test('only infrastructure failures permit local fallback', () => {
  assert.equal(gateway.fallbackAllowed({ code: 'OPENMANUS_UNAVAILABLE' }), true);
  assert.equal(gateway.fallbackAllowed({ code: 'OPENMANUS_HTTP_503' }), true);
  assert.equal(gateway.fallbackAllowed({ code: 'OPENMANUS_TASK_FAILED' }), false);
});

test('invalid mode is safely treated as disabled', () => withEnv({ OPENMANUS_RUNTIME_MODE: 'unsafe-mode' }, () => {
  assert.equal(gateway.configuration().mode, 'disabled');
  assert.equal(gateway.shouldDelegate({ taskId: 'task-1' }), false);
}));
