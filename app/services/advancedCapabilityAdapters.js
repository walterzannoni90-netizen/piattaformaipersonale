'use strict';

function createAdvancedCapabilityAdapters(deps = {}) {
  const {
    browserRuntime,
    codebase,
    graphStore,
    evaluator,
    planner,
    toolRegistry,
    dashboard,
    distributedCoordinator,
    regressionRunner,
    identityScanner
  } = deps;

  return {
    'browser-autonomy': async ({ browserGoal, session }) => ({
      output: await browserRuntime?.executeGoal?.({ goal: browserGoal, session, recover: true, persistSession: true }),
      metrics: { capability: 'browser-autonomy' }
    }),

    'codebase-autonomy': async ({ repository, objective, constraints = {} }) => ({
      output: await codebase?.analyzeAndChange?.({ repository, objective, constraints, requireTests: true, requireDiffReview: true }),
      metrics: { capability: 'codebase-autonomy' }
    }),

    'knowledge-graph': async ({ entities = [], relations = [], query }) => {
      await graphStore?.upsert?.({ entities, relations });
      return { output: query ? await graphStore?.query?.(query) : { entities: entities.length, relations: relations.length } };
    },

    'self-improvement': async ({ executionHistory = [], policy = {} }) => {
      const evaluation = await evaluator?.evaluateHistory?.(executionHistory);
      const proposal = await evaluator?.proposeImprovement?.({ evaluation, policy });
      return { output: { evaluation, proposal, requiresApproval: proposal?.risk !== 'low' } };
    },

    'strategic-planning': async ({ goal, horizon, objectives = [], constraints = [] }) => ({
      output: await planner?.createStrategicPlan?.({ goal, horizon, objectives, constraints, parallelize: true, checkpoints: true })
    }),

    'tool-ecosystem': async ({ requestedCapability, manifest }) => {
      const discovered = await toolRegistry?.discover?.(requestedCapability);
      const validated = manifest ? await toolRegistry?.validateManifest?.(manifest) : null;
      return { output: { discovered: discovered || [], validated, hotReloadEligible: Boolean(validated?.safe) } };
    },

    'production-dashboard': async ({ scope = 'runtime' }) => ({
      output: await dashboard?.snapshot?.({ scope, includeAgents: true, includeCosts: true, includeFailures: true, includeLatency: true })
    }),

    'distributed-runtime': async ({ task, placement = {} }) => ({
      output: await distributedCoordinator?.dispatch?.({ task, placement, idempotent: true, checkpointed: true })
    }),

    'continuous-evaluation': async ({ suite, baseline }) => {
      const result = await regressionRunner?.run?.({ suite, baseline, failOnRegression: true });
      return { status: result?.passed === false ? 'failed' : 'completed', output: result };
    },

    'product-identity': async ({ paths = [], approvedTerms = [], protectedNotices = [] }) => ({
      output: await identityScanner?.scan?.({ paths, approvedTerms, protectedNotices, preserveLegalAttribution: true })
    })
  };
}

module.exports = { createAdvancedCapabilityAdapters };