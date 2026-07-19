'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ProductionIntegrationHub, REQUIRED_AREAS } = require('../app/services/productionIntegrationHub');
const { runUnifiedTaskRuntime } = require('../app/services/unifiedTaskRuntime');

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

test('rejects incomplete service contracts', () => {
  const services = healthyServices();
  delete services.models.embed;
  assert.throws(() => new ProductionIntegrationHub(services), (error) => {
    assert.equal(error.code, 'PRODUCTION_SERVICE_INVALID');
    assert.equal(error.area, 'models');
    assert.deepEqual(error.missingMethods, ['embed']);
    return true;
  });
});

test('reports exact readiness for all integrations', async () => {
  const hub = new ProductionIntegrationHub(healthyServices());
  const health = await hub.health();
  assert.equal(health.ready, true);
  assert.equal(health.required, 6);
  assert.equal(health.readyCount, 6);
  assert.equal(health.failures.length, 0);
});

test('converts thrown health checks into fail-closed readiness failures', async () => {
  const services = healthyServices({
    models: {
      complete: async () => 'ok',
      embed: async () => [1],
      health: async () => {
        const error = new Error('provider offline');
        error.code = 'MODEL_PROVIDER_OFFLINE';
        throw error;
      }
    }
  });
  const health = await new ProductionIntegrationHub(services).health();
  assert.equal(health.ready, false);
  assert.equal(health.failures[0].area, 'models');
  assert.equal(health.failures[0].detail.code, 'MODEL_PROVIDER_OFFLINE');
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
        assert.equal(typeof context.browser.execute, 'function');
        assert.equal(typeof context.sandboxRepository.test, 'function');
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

test('emits lifecycle telemetry for successful and failed production runs', async () => {
  const events = [];
  const successHub = new ProductionIntegrationHub({
    ...healthyServices(),
    telemetry: { record: async (event) => events.push(event) }
  });
  await successHub.execute({ id: 'telemetry-success' }, { runId: 'run-success' });
  assert.deepEqual(events.map((event) => event.type), ['production.run.started', 'production.run.completed']);

  const failedEvents = [];
  const failedHub = new ProductionIntegrationHub({
    ...healthyServices({
      agents: {
        health: async () => ({ ready: true }),
        execute: async () => { throw new Error('agent failed'); }
      }
    }),
    telemetry: { record: async (event) => failedEvents.push(event) }
  });
  await assert.rejects(() => failedHub.execute({ id: 'telemetry-failure' }, { runId: 'run-failure' }), /agent failed/);
  assert.deepEqual(failedEvents.map((event) => event.type), ['production.run.started', 'production.run.failed']);
});

test('unified runtime gives the production integration hub highest priority', async () => {
  const calls = [];
  const integrationHub = {
    execute: async (task, options) => {
      calls.push({ task, options });
      return { complete: true, source: 'production-integration-hub' };
    }
  };
  const result = await runUnifiedTaskRuntime({
    task: { id: 'priority-task' },
    productionIntegrationHub: integrationHub,
    productionIntegrationOptions: { runId: 'priority-run' },
    operationalRuntime: { execute: async () => { throw new Error('must not run'); } }
  });
  assert.equal(result.source, 'production-integration-hub');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.runId, 'priority-run');
});
