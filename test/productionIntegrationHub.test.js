'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ProductionIntegrationHub, REQUIRED_AREAS } = require('../app/services/productionIntegrationHub');

function healthyServices(overrides = {}) {
  const health = async () => ({ ready: true });
  const services = {
    agents: { health, execute: async ({ task }) => ({ taskId: task.id, status: 'completed' }) },
    browser: { health, execute: async () => ({ ok: true }) },
    models: { health, complete: async () => 'ok', embed: async () => [1, 0] },
    persistence: { health, load: async () => null, save: async () => undefined },
    sandboxRepository: {
      health,
      execute: async () => ({ code: 0 }),
      read: async () => '',
      write: async () => undefined,
      test: async () => ({ passed: true })
    },
    endToEnd: { health, run: async () => ({ passed: true }) }
  };
  return { ...services, ...overrides };
}

test('requires all six production areas', () => {
  assert.deepEqual(REQUIRED_AREAS, ['agents', 'browser', 'models', 'persistence', 'sandboxRepository', 'endToEnd']);
  assert.throws(() => new ProductionIntegrationHub({}), /Servizio di produzione mancante/);
});

test('reports exact readiness for all integrations', async () => {
  const hub = new ProductionIntegrationHub(healthyServices());
  const health = await hub.health();
  assert.equal(health.ready, true);
  assert.equal(health.required, 6);
  assert.equal(health.readyCount, 6);
  assert.equal(health.failures.length, 0);
});

test('blocks execution when an external integration is unhealthy', async () => {
  const services = healthyServices({
    browser: { execute: async () => null, health: async () => ({ ready: false, reason: 'driver unavailable' }) }
  });
  const hub = new ProductionIntegrationHub(services);
  await assert.rejects(() => hub.execute({ id: 'task-1' }), (error) => {
    assert.equal(error.code, 'PRODUCTION_INTEGRATIONS_NOT_READY');
    assert.equal(error.health.failures[0].area, 'browser');
    return true;
  });
});

test('executes agents, persists result and verifies end-to-end', async () => {
  const calls = [];
  const services = healthyServices({
    persistence: {
      health: async () => ({ ready: true }),
      load: async (value) => { calls.push(['load', value]); return { cursor: 4 }; },
      save: async (value) => { calls.push(['save', value]); }
    },
    agents: {
      health: async () => ({ ready: true }),
      execute: async (context) => {
        assert.equal(context.checkpoint.cursor, 4);
        assert.equal(typeof context.models.complete, 'function');
        return { status: 'completed', output: 42 };
      }
    },
    endToEnd: {
      health: async () => ({ ready: true }),
      run: async ({ result }) => ({ passed: result.output === 42 })
    }
  });
  const hub = new ProductionIntegrationHub(services);
  const output = await hub.execute({ id: 'task-2' }, { runId: 'run-fixed' });
  assert.equal(output.complete, true);
  assert.equal(output.runId, 'run-fixed');
  assert.equal(calls[0][0], 'load');
  assert.equal(calls[1][1].status, 'completed');
});

test('persists failures from agents or end-to-end verification', async () => {
  const saved = [];
  const services = healthyServices({
    agents: { health: async () => ({ ready: true }), execute: async () => ({ output: 'bad' }) },
    persistence: {
      health: async () => ({ ready: true }),
      load: async () => null,
      save: async (value) => saved.push(value)
    },
    endToEnd: { health: async () => ({ ready: true }), run: async () => ({ passed: false }) }
  });
  const hub = new ProductionIntegrationHub(services);
  await assert.rejects(() => hub.execute({ id: 'task-3' }), (error) => error.code === 'END_TO_END_VERIFICATION_FAILED');
  assert.equal(saved.at(-1).status, 'failed');
  assert.equal(saved.at(-1).code, 'END_TO_END_VERIFICATION_FAILED');
});