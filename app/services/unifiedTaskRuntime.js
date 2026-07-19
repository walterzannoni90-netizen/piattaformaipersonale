'use strict';

const { normalizeLegacyPlan } = require('./plannerOrchestrator');
const { runAutonomyRuntime } = require('./autonomyRuntime');

async function runUnifiedTaskRuntime({
  task,
  legacyPlan,
  handlers,
  checkpoint,
  approve,
  replan,
  evaluate,
  memory,
  browser,
  onEvent,
  signal,
  maxReplans = 2,
  operationalRuntime,
  operationalContext = {},
  productionRuntime,
  productionOptions = {}
}) {
  if (!task || !task.id) throw new Error('Task obbligatorio');

  if (operationalRuntime && typeof operationalRuntime.execute === 'function') {
    const health = typeof operationalRuntime.health === 'function' ? operationalRuntime.health() : { ready: true };
    if (!health.ready) {
      const error = new Error('Runtime operativo non pronto');
      error.code = 'OPERATIONAL_RUNTIME_NOT_READY';
      error.health = health;
      throw error;
    }
    return operationalRuntime.execute({ ...operationalContext, task, goal: operationalContext.goal || task.goal || task.title, signal });
  }

  if (productionRuntime && typeof productionRuntime.execute === 'function') {
    return productionRuntime.execute(task, {
      ...productionOptions,
      signal,
      legacyPlan,
      handlers
    });
  }

  if (!legacyPlan || !Array.isArray(legacyPlan.steps)) throw new Error('Piano obbligatorio');
  if (!handlers || typeof handlers !== 'object') throw new Error('Handler strumenti obbligatori');
  const plan = normalizeLegacyPlan({ task, legacyPlan });

  return runAutonomyRuntime({
    plan,
    execute: async ({ step, attempt, signal: runtimeSignal }) => {
      const handler = handlers[step.tool];
      if (typeof handler !== 'function') {
        const error = new Error(`Handler non disponibile: ${step.tool}`);
        error.code = 'handler_not_available';
        throw error;
      }
      return handler({ task, step, attempt, plan, signal: runtimeSignal });
    },
    checkpoint,
    approve,
    replan,
    evaluate,
    memory,
    browser,
    onEvent,
    signal,
    maxReplans
  });
}

module.exports = { runUnifiedTaskRuntime };
