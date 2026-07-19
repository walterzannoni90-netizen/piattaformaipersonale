'use strict';

function required(service, method, track) {
  if (!service || typeof service[method] !== 'function') {
    const error = new Error(`Dipendenza operativa non configurata: ${track}`);
    error.code = 'OPERATIONAL_DEPENDENCY_MISSING';
    throw error;
  }
  return service[method].bind(service);
}

function createOperationalCapabilityAdapters(deps = {}) {
  return {
    'browser-session': async ({ browserGoal, session }) => ({
      output: await required(deps.browserRuntime, 'executeGoal', 'browser-session')({ goal: browserGoal, session, persistSession: true, recover: true })
    }),
    'repository-change': async ({ repository, objective, constraints = {} }) => ({
      output: await required(deps.codeRuntime, 'analyzeAndChange', 'repository-change')({ repository, objective, constraints, requireTests: true, requireDiffReview: true })
    }),
    'semantic-memory': async ({ memories = [], query }) => {
      const upsert = required(deps.semanticMemory, 'upsert', 'semantic-memory');
      for (const memory of memories) await upsert(memory);
      return { output: query ? await required(deps.semanticMemory, 'search', 'semantic-memory')(query) : { stored: memories.length } };
    },
    'adaptive-improvement': async ({ executionHistory = [], policy = {} }) => ({
      output: await required(deps.selfImprover, 'propose', 'adaptive-improvement')({ executionHistory, policy, requireApproval: true })
    }),
    'strategic-execution': async ({ goal, constraints = [] }) => ({
      output: await required(deps.planner, 'plan', 'strategic-execution')({ goal, constraints, checkpoints: true, parallelize: true })
    }),
    'tool-discovery': async ({ capability }) => ({
      output: await required(deps.toolRegistry, 'discover', 'tool-discovery')(capability)
    }),
    'live-observability': async ({ scope = 'runtime' }) => ({
      output: await required(deps.observability, 'snapshot', 'live-observability')({ scope, includeCosts: true, includeLatency: true, includeFailures: true })
    }),
    'distributed-placement': async ({ task, placement = {} }) => ({
      output: await required(deps.distributedRuntime, 'dispatch', 'distributed-placement')({ task, placement, idempotent: true, checkpointed: true })
    }),
    'continuous-regression': async ({ suite, baseline }) => {
      const result = await required(deps.regressionRunner, 'run', 'continuous-regression')({ suite, baseline, failOnRegression: true });
      return { status: result?.passed === false ? 'failed' : 'completed', output: result };
    },
    'release-readiness': async ({ release }) => {
      const output = await required(deps.releaseGate, 'evaluate', 'release-readiness')({ release, requireSecurity: true, requireTests: true, requireRollback: true });
      return { status: output?.ready === false ? 'blocked' : 'completed', output };
    }
  };
}

module.exports = { createOperationalCapabilityAdapters };
