'use strict';

const crypto = require('crypto');
const { createPlan } = require('./autonomousPlanner');
const { runResilientPlan } = require('./resilientExecutor');

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function clean(value, max = 4000) { return String(value || '').replace(/[\u0000-\u001F]/g, '').trim().slice(0, max); }
function tokenize(value) { return [...new Set(clean(value, 12000).toLowerCase().split(/[^a-z0-9à-ÿ_]+/i).filter((word) => word.length > 2))]; }

class WorkingMemory {
  constructor({ limit = 100, persist } = {}) {
    this.limit = Math.max(10, Math.min(Number(limit) || 100, 1000));
    this.persist = typeof persist === 'function' ? persist : null;
    this.items = [];
  }

  async remember({ kind = 'observation', content, metadata = {}, importance = 0.5 }) {
    const text = clean(content, 12000);
    if (!text) return null;
    const item = {
      id: crypto.createHash('sha256').update(`${kind}:${text}`).digest('hex').slice(0, 20),
      kind: clean(kind, 40), content: text, metadata: clone(metadata),
      importance: Math.max(0, Math.min(Number(importance) || 0, 1)),
      tokens: tokenize(text), createdAt: new Date().toISOString()
    };
    this.items = [item, ...this.items.filter((entry) => entry.id !== item.id)]
      .sort((a, b) => b.importance - a.importance || b.createdAt.localeCompare(a.createdAt))
      .slice(0, this.limit);
    if (this.persist) await this.persist(clone(item));
    return clone(item);
  }

  recall(query, { limit = 8, kinds = null } = {}) {
    const terms = tokenize(query);
    const allowed = Array.isArray(kinds) && kinds.length ? new Set(kinds) : null;
    return this.items
      .filter((item) => !allowed || allowed.has(item.kind))
      .map((item) => ({
        ...item,
        score: item.importance + terms.filter((term) => item.tokens.includes(term)).length / Math.max(terms.length, 1)
      }))
      .filter((item) => !terms.length || item.score > item.importance)
      .sort((a, b) => b.score - a.score || b.createdAt.localeCompare(a.createdAt))
      .slice(0, Math.max(1, Math.min(Number(limit) || 8, 30)))
      .map(({ tokens, ...item }) => clone(item));
  }
}

function evaluateResult({ result, criteria = {}, step }) {
  const failures = [];
  if (result === undefined || result === null) failures.push('empty_result');
  const serialized = (() => { try { return JSON.stringify(result); } catch { return ''; } })();
  if (criteria.minLength && serialized.length < criteria.minLength) failures.push('result_too_short');
  if (criteria.requiredKeys && typeof result === 'object') {
    for (const key of criteria.requiredKeys) if (!(key in result)) failures.push(`missing_key:${key}`);
  }
  if (criteria.mustContain) {
    for (const value of criteria.mustContain) if (!serialized.toLowerCase().includes(String(value).toLowerCase())) failures.push(`missing_content:${value}`);
  }
  if (result && typeof result === 'object' && result.passed === false) failures.push('explicit_quality_failure');
  return { passed: failures.length === 0, failures, stepId: step?.id || null, size: serialized.length };
}

function createCorrectivePlan({ plan, failedStep, evaluation, error }) {
  const completedIds = new Set(plan.steps.filter((step) => plan.state[step.id]?.status === 'completed').map((step) => step.id));
  const correctiveId = `repair-${failedStep.id}-${Number(plan.metadata?.replanCount || 0) + 1}`;
  const steps = plan.steps
    .filter((step) => completedIds.has(step.id))
    .map((step) => ({ ...step, dependsOn: step.dependsOn || [] }));
  steps.push({
    id: correctiveId,
    title: `Correggi ${failedStep.title}`,
    tool: failedStep.tool,
    input: {
      ...(failedStep.input || {}),
      correctionContext: {
        failures: evaluation?.failures || [],
        error: clean(error?.message || error, 1000),
        previousStepId: failedStep.id
      }
    },
    dependsOn: [...completedIds].slice(-1),
    maxAttempts: Math.max(1, Number(failedStep.maxAttempts || 2)),
    approvalRequired: false
  });
  return createPlan({
    goal: plan.goal,
    taskId: plan.id,
    steps,
    metadata: { ...(plan.metadata || {}), correctiveFor: failedStep.id }
  });
}

async function runBrowserAutopilot({ goal, observe, act, allowedActions = [], maxActions = 12, signal, memory, evaluate }) {
  if (typeof observe !== 'function' || typeof act !== 'function') throw new Error('Browser observe/act obbligatori');
  const allowed = new Set(allowedActions);
  const history = [];
  for (let index = 0; index < Math.max(1, Math.min(Number(maxActions) || 12, 50)); index += 1) {
    if (signal?.aborted) return { status: 'cancelled', history };
    const observation = await observe({ goal, history: clone(history), signal });
    await memory?.remember({ kind: 'browser_observation', content: JSON.stringify(observation), metadata: { index }, importance: 0.35 });
    if (observation?.done) return { status: 'completed', result: observation.result || null, history };
    const proposed = observation?.nextAction;
    if (!proposed || !allowed.has(proposed.type)) {
      const error = new Error(`Azione browser non consentita: ${proposed?.type || 'assente'}`);
      error.code = 'BROWSER_ACTION_NOT_ALLOWED';
      throw error;
    }
    if (proposed.requiresApproval) {
      const error = new Error('Azione browser con effetto esterno richiede approvazione');
      error.code = 'approval_required';
      throw error;
    }
    const result = await act({ action: clone(proposed), observation: clone(observation), signal });
    history.push({ action: clone(proposed), result: clone(result) });
    const assessment = typeof evaluate === 'function' ? await evaluate({ observation, action: proposed, result, history: clone(history) }) : { passed: true };
    if (assessment?.passed === false) {
      await memory?.remember({ kind: 'browser_failure', content: JSON.stringify(assessment), metadata: { proposed }, importance: 0.8 });
    }
  }
  const error = new Error('Limite azioni browser raggiunto');
  error.code = 'BROWSER_ACTION_LIMIT';
  throw error;
}

async function runAutonomyRuntime({ plan, execute, checkpoint, approve, signal, memory = new WorkingMemory(), criteriaForStep, onEvent, maxReplans = 2 }) {
  return runResilientPlan({
    plan,
    signal,
    approve,
    checkpoint: async (snapshot, event) => {
      await checkpoint?.(snapshot, event);
      await memory.remember({ kind: 'checkpoint', content: JSON.stringify({ status: snapshot.status, event: event.type }), metadata: { taskId: snapshot.id }, importance: 0.45 });
    },
    onEvent,
    execute: async (context) => {
      const recalled = memory.recall(`${context.plan.goal} ${context.step.title}`, { limit: 6 });
      const result = await execute({ ...context, memory: recalled });
      const evaluation = evaluateResult({ result, criteria: criteriaForStep?.(context.step) || {}, step: context.step });
      await memory.remember({
        kind: evaluation.passed ? 'step_result' : 'step_failure',
        content: JSON.stringify({ step: context.step.id, evaluation, result }),
        metadata: { taskId: context.plan.id, stepId: context.step.id },
        importance: evaluation.passed ? 0.55 : 0.9
      });
      if (!evaluation.passed) {
        const error = new Error(`Risultato non valido: ${evaluation.failures.join(', ')}`);
        error.code = 'RESULT_EVALUATION_FAILED';
        error.evaluation = evaluation;
        throw error;
      }
      return result;
    },
    replan: async ({ plan: failedPlan, failedStep, error }) => createCorrectivePlan({
      plan: failedPlan,
      failedStep,
      evaluation: error?.evaluation || { failures: [error?.code || 'execution_failed'] },
      error
    }),
    maxReplans
  });
}

module.exports = { WorkingMemory, evaluateResult, createCorrectivePlan, runBrowserAutopilot, runAutonomyRuntime };
