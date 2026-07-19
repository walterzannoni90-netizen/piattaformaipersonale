'use strict';

const REQUIRED_AREAS = Object.freeze([
  'agents',
  'browser',
  'models',
  'persistence',
  'sandboxRepository',
  'endToEnd'
]);

function isFunction(value) {
  return typeof value === 'function';
}

function assertService(name, service, methods) {
  if (!service || typeof service !== 'object') {
    const error = new Error(`Servizio di produzione mancante: ${name}`);
    error.code = 'PRODUCTION_SERVICE_MISSING';
    error.area = name;
    throw error;
  }
  const missing = methods.filter((method) => !isFunction(service[method]));
  if (missing.length) {
    const error = new Error(`Servizio ${name} incompleto: ${missing.join(', ')}`);
    error.code = 'PRODUCTION_SERVICE_INVALID';
    error.area = name;
    error.missingMethods = missing;
    throw error;
  }
  return service;
}

async function probe(name, service) {
  try {
    const result = isFunction(service.health) ? await service.health() : { ready: true };
    const ready = result === true || result?.ready === true;
    return { area: name, ready, detail: result || null };
  } catch (error) {
    return { area: name, ready: false, detail: { error: error.message, code: error.code || 'HEALTHCHECK_FAILED' } };
  }
}

class ProductionIntegrationHub {
  constructor({ agents, browser, models, persistence, sandboxRepository, endToEnd, telemetry } = {}) {
    this.services = {
      agents: assertService('agents', agents, ['execute', 'health']),
      browser: assertService('browser', browser, ['execute', 'health']),
      models: assertService('models', models, ['complete', 'embed', 'health']),
      persistence: assertService('persistence', persistence, ['load', 'save', 'health']),
      sandboxRepository: assertService('sandboxRepository', sandboxRepository, ['execute', 'read', 'write', 'test', 'health']),
      endToEnd: assertService('endToEnd', endToEnd, ['run', 'health'])
    };
    this.telemetry = telemetry;
  }

  async health() {
    const checks = await Promise.all(REQUIRED_AREAS.map((area) => probe(area, this.services[area])));
    const failures = checks.filter((check) => !check.ready);
    return {
      ready: failures.length === 0,
      required: REQUIRED_AREAS.length,
      readyCount: checks.length - failures.length,
      checks,
      failures
    };
  }

  async assertReady() {
    const health = await this.health();
    if (!health.ready) {
      const error = new Error(`Integrazioni di produzione non pronte: ${health.failures.map((item) => item.area).join(', ')}`);
      error.code = 'PRODUCTION_INTEGRATIONS_NOT_READY';
      error.health = health;
      throw error;
    }
    return health;
  }

  async execute(task, options = {}) {
    if (!task?.id) throw new Error('Task obbligatorio');
    await this.assertReady();
    const runId = options.runId || `production-${task.id}-${Date.now()}`;
    await this.record('production.run.started', { runId, taskId: task.id });

    const checkpoint = await this.services.persistence.load({ taskId: task.id, runId });
    const context = {
      ...options,
      runId,
      task,
      checkpoint,
      browser: this.services.browser,
      models: this.services.models,
      persistence: this.services.persistence,
      sandboxRepository: this.services.sandboxRepository
    };

    try {
      const result = await this.services.agents.execute(context);
      await this.services.persistence.save({ taskId: task.id, runId, status: 'completed', result });
      const verification = await this.services.endToEnd.run({ task, runId, result, context });
      if (verification?.passed !== true) {
        const error = new Error('Verifica end-to-end non superata');
        error.code = 'END_TO_END_VERIFICATION_FAILED';
        error.verification = verification;
        throw error;
      }
      await this.record('production.run.completed', { runId, taskId: task.id });
      return { runId, result, verification, complete: true };
    } catch (error) {
      await this.services.persistence.save({
        taskId: task.id,
        runId,
        status: 'failed',
        error: error.message,
        code: error.code || 'PRODUCTION_RUN_FAILED'
      });
      await this.record('production.run.failed', { runId, taskId: task.id, error: error.message, code: error.code });
      throw error;
    }
  }

  async record(type, payload) {
    await this.telemetry?.record?.({ type, ...payload, at: new Date().toISOString() });
  }
}

function createProductionIntegrationHub(deps = {}) {
  return new ProductionIntegrationHub(deps);
}

module.exports = {
  REQUIRED_AREAS,
  ProductionIntegrationHub,
  createProductionIntegrationHub,
  assertService,
  probe
};