'use strict';

const vm = require('vm');

function cosine(a = [], b = []) {
  const size = Math.min(a.length, b.length);
  let dot = 0; let aa = 0; let bb = 0;
  for (let i = 0; i < size; i += 1) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return aa && bb ? dot / (Math.sqrt(aa) * Math.sqrt(bb)) : 0;
}

function createCapabilityAdapters(deps = {}) {
  const { browser, terminal, codeEditor, testRunner, memory, pluginRegistry, telemetry, benchmarkRunner } = deps;
  return {
    'semantic-memory': async ({ query, embedding }) => {
      const items = await memory?.list?.() || [];
      const ranked = items.map((item) => ({ ...item, score: cosine(embedding || [], item.embedding || []) }))
        .sort((a, b) => b.score - a.score).slice(0, 8);
      return { output: { query, matches: ranked }, metrics: { searched: items.length } };
    },
    'self-reflection': async ({ execution = {} }) => {
      const weaknesses = [];
      if (!execution.verification?.passed) weaknesses.push('verification');
      if ((execution.retries || 0) > 1) weaknesses.push('reliability');
      if ((execution.cost || 0) > (execution.budget || Infinity)) weaknesses.push('cost');
      const lesson = { weaknesses, improve: weaknesses.map((item) => `reduce:${item}`), source: execution.id || null };
      await memory?.appendEvent?.({ type: 'reflection.lesson', payload: lesson });
      return { output: lesson, metrics: { weaknesses: weaknesses.length } };
    },
    'dynamic-replanning': async ({ plan = [], failedStepId, replacement = [] }) => {
      const next = plan.flatMap((step) => step.id === failedStepId ? replacement : [step]);
      return { output: { previousSize: plan.length, plan: next, replaced: failedStepId || null } };
    },
    'hierarchical-planning': async ({ goal, objectives = [] }) => ({
      output: { goal, objectives: objectives.map((objective, index) => ({ id: `objective-${index + 1}`, objective, tasks: [{ id: `task-${index + 1}-1`, title: objective, done: false }] })) }
    }),
    'autonomous-browser': async ({ browserTask }) => ({ output: await browser?.execute?.(browserTask), metrics: { tool: 'browser' } }),
    'autonomous-terminal': async ({ command, cwd, timeoutMs = 30_000 }) => ({ output: await terminal?.execute?.({ command, cwd, timeoutMs }), metrics: { tool: 'terminal' } }),
    'autonomous-code-editing': async ({ patch, workspace }) => ({ output: await codeEditor?.apply?.({ patch, workspace }), metrics: { tool: 'code-editor' } }),
    'automatic-testing': async ({ testCommand, workspace }) => {
      const result = await testRunner?.run?.({ command: testCommand, workspace });
      return { status: result?.passed === false ? 'failed' : 'completed', output: result, metrics: { tests: result?.total || 0 } };
    },
    'isolated-sandbox': async ({ source, context = {}, timeoutMs = 1_000 }) => {
      const sandbox = vm.createContext(Object.freeze({ ...context }));
      const script = new vm.Script(`'use strict';(${source})`, { timeout: timeoutMs });
      return { output: script.runInContext(sandbox, { timeout: timeoutMs }) };
    },
    'long-running-tasks': async ({ taskId, checkpoint }) => {
      await memory?.appendEvent?.({ type: 'continuity.checkpoint', payload: { taskId, checkpoint } });
      return { output: { taskId, checkpointed: true, resumable: true } };
    },
    'experience-learning': async ({ outcome }) => {
      const experience = { input: outcome?.input, action: outcome?.action, reward: Number(outcome?.reward) || 0, at: new Date().toISOString() };
      await memory?.appendEvent?.({ type: 'experience.recorded', payload: experience });
      return { output: experience };
    },
    'agent-benchmarks': async ({ benchmark }) => ({ output: await benchmarkRunner?.run?.(benchmark), metrics: { benchmark: benchmark?.name || 'anonymous' } }),
    'dynamic-plugins': async ({ plugin }) => {
      if (!plugin?.id || typeof plugin.handler !== 'function') throw new Error('Plugin non valido');
      pluginRegistry?.register?.(plugin.id, plugin.handler, plugin.manifest || {});
      return { output: { pluginId: plugin.id, registered: true } };
    },
    'multi-objective-planning': async ({ objectives = [], weights = {} }) => {
      const ranked = objectives.map((objective) => ({ ...objective, score: Object.entries(objective.metrics || {}).reduce((sum, [key, value]) => sum + (weights[key] || 0) * value, 0) })).sort((a, b) => b.score - a.score);
      return { output: { ranked } };
    },
    'observability-dashboard': async ({ snapshot = {} }) => {
      await telemetry?.record?.({ type: 'dashboard.snapshot', ...snapshot });
      return { output: { health: snapshot.failures ? 'degraded' : 'healthy', snapshot } };
    },
    'cost-time-token-optimization': async ({ candidates = [], limits = {} }) => {
      const feasible = candidates.filter((item) => (item.cost || 0) <= (limits.cost ?? Infinity) && (item.latencyMs || 0) <= (limits.latencyMs ?? Infinity) && (item.tokens || 0) <= (limits.tokens ?? Infinity));
      feasible.sort((a, b) => ((b.quality || 0) / Math.max(1, (b.cost || 0) + (b.latencyMs || 0) / 1000 + (b.tokens || 0) / 1000)) - ((a.quality || 0) / Math.max(1, (a.cost || 0) + (a.latencyMs || 0) / 1000 + (a.tokens || 0) / 1000)));
      return { output: { selected: feasible[0] || null, feasible: feasible.length } };
    }
  };
}

module.exports = { createCapabilityAdapters, cosine };
