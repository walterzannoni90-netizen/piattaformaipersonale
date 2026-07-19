'use strict';

const { normalizeLegacyPlan } = require('./plannerOrchestrator');
const { runAutonomyRuntime } = require('./autonomyRuntime');

/**
 * Single compatibility bridge between persisted legacy task plans and the
 * resilient autonomy runtime. It keeps the migration boundary explicit so
 * agentOrchestrator can delegate execution without maintaining a second loop.
 */
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
  maxReplans = 2
}) {
  if (!task || !task.id) throw new Error('Task obbligatorio');
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
