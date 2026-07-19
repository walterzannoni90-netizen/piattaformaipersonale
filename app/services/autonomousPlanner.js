'use strict';

const crypto = require('crypto');

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const STEP_STATES = new Set(['pending', 'running', 'completed', 'failed', 'blocked', 'cancelled']);

function clean(value, max = 500) {
  return String(value || '').replace(/[\u0000-\u001F]/g, '').trim().slice(0, max);
}

function stableId(seed) {
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

function normalizeStep(step, index, knownIds) {
  const id = clean(step.id || `step-${index + 1}`, 64);
  if (!id || knownIds.has(id)) throw new Error(`Step id non valido o duplicato: ${id || index + 1}`);
  knownIds.add(id);
  const dependsOn = Array.isArray(step.dependsOn) ? [...new Set(step.dependsOn.map((value) => clean(value, 64)).filter(Boolean))] : [];
  return Object.freeze({
    id,
    title: clean(step.title || `Passaggio ${index + 1}`, 140),
    tool: clean(step.tool || 'reasoning', 80),
    input: Object.freeze({ ...(step.input && typeof step.input === 'object' && !Array.isArray(step.input) ? step.input : {}) }),
    dependsOn: Object.freeze(dependsOn),
    maxAttempts: Math.max(1, Math.min(Number(step.maxAttempts || 2), 5)),
    approvalRequired: step.approvalRequired === true
  });
}

function validateGraph(steps) {
  const ids = new Set(steps.map((step) => step.id));
  for (const step of steps) {
    for (const dependency of step.dependsOn) {
      if (!ids.has(dependency)) throw new Error(`Dipendenza sconosciuta ${dependency} per ${step.id}`);
      if (dependency === step.id) throw new Error(`Dipendenza ciclica su ${step.id}`);
    }
  }
  const visiting = new Set();
  const visited = new Set();
  const byId = new Map(steps.map((step) => [step.id, step]));
  function visit(id) {
    if (visiting.has(id)) throw new Error('Il piano contiene un ciclo');
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependsOn) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  }
  for (const step of steps) visit(step.id);
}

function createPlan({ goal, steps, taskId = null, metadata = {} }) {
  const normalizedGoal = clean(goal, 4000);
  if (!normalizedGoal) throw new Error('Obiettivo obbligatorio');
  if (!Array.isArray(steps) || steps.length === 0 || steps.length > 30) throw new Error('Il piano deve contenere da 1 a 30 step');
  const knownIds = new Set();
  const normalizedSteps = steps.map((step, index) => normalizeStep(step || {}, index, knownIds));
  validateGraph(normalizedSteps);
  const id = clean(taskId, 80) || stableId(`${normalizedGoal}:${JSON.stringify(normalizedSteps)}`);
  const state = Object.fromEntries(normalizedSteps.map((step) => [step.id, {
    status: 'pending', attempts: 0, result: null, error: null, approvalHash: null, startedAt: null, completedAt: null
  }]));
  return {
    id,
    goal: normalizedGoal,
    status: 'pending',
    steps: normalizedSteps,
    state,
    metadata: { ...metadata },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function assertPlan(plan) {
  if (!plan || !Array.isArray(plan.steps) || !plan.state) throw new Error('Piano non valido');
}

function dependenciesCompleted(plan, step) {
  return step.dependsOn.every((dependency) => plan.state[dependency]?.status === 'completed');
}

function dependencyFailed(plan, step) {
  return step.dependsOn.some((dependency) => ['failed', 'cancelled', 'blocked'].includes(plan.state[dependency]?.status));
}

function refreshBlocked(plan) {
  for (const step of plan.steps) {
    const current = plan.state[step.id];
    if (current.status === 'pending' && dependencyFailed(plan, step)) current.status = 'blocked';
  }
}

function nextRunnable(plan) {
  assertPlan(plan);
  refreshBlocked(plan);
  if (TERMINAL.has(plan.status)) return null;
  return plan.steps.find((step) => plan.state[step.id].status === 'pending' && dependenciesCompleted(plan, step)) || null;
}

function approvalHash(plan, step) {
  return crypto.createHash('sha256').update(`${plan.id}:${step.id}:${JSON.stringify(step.input)}`).digest('hex');
}

function startStep(plan, stepId, approvedHash = null) {
  assertPlan(plan);
  const step = plan.steps.find((item) => item.id === stepId);
  if (!step) throw new Error('Step non trovato');
  const current = plan.state[step.id];
  if (current.status !== 'pending') throw new Error(`Step non avviabile: ${current.status}`);
  if (!dependenciesCompleted(plan, step)) throw new Error('Dipendenze non completate');
  if (step.approvalRequired) {
    const expected = approvalHash(plan, step);
    current.approvalHash = expected;
    if (approvedHash !== expected) {
      const error = new Error('Approvazione richiesta');
      error.code = 'approval_required';
      error.approvalHash = expected;
      throw error;
    }
  }
  current.status = 'running';
  current.attempts += 1;
  current.startedAt = new Date().toISOString();
  current.error = null;
  plan.status = 'running';
  plan.updatedAt = current.startedAt;
  return step;
}

function completeStep(plan, stepId, result) {
  assertPlan(plan);
  const current = plan.state[stepId];
  if (!current || current.status !== 'running') throw new Error('Step non in esecuzione');
  current.status = 'completed';
  current.result = result === undefined ? null : result;
  current.completedAt = new Date().toISOString();
  plan.updatedAt = current.completedAt;
  refreshPlanStatus(plan);
}

function failStep(plan, stepId, error) {
  assertPlan(plan);
  const step = plan.steps.find((item) => item.id === stepId);
  const current = plan.state[stepId];
  if (!step || !current || current.status !== 'running') throw new Error('Step non in esecuzione');
  current.error = clean(error?.message || error, 2000) || 'Errore sconosciuto';
  current.completedAt = new Date().toISOString();
  current.status = current.attempts < step.maxAttempts ? 'pending' : 'failed';
  plan.updatedAt = current.completedAt;
  refreshPlanStatus(plan);
  return current.status === 'pending';
}

function cancelPlan(plan) {
  assertPlan(plan);
  for (const current of Object.values(plan.state)) {
    if (!STEP_STATES.has(current.status)) throw new Error('Stato step non valido');
    if (['pending', 'running'].includes(current.status)) current.status = 'cancelled';
  }
  plan.status = 'cancelled';
  plan.updatedAt = new Date().toISOString();
}

function refreshPlanStatus(plan) {
  refreshBlocked(plan);
  const statuses = Object.values(plan.state).map((value) => value.status);
  if (statuses.every((status) => status === 'completed')) plan.status = 'completed';
  else if (statuses.some((status) => status === 'failed')) plan.status = 'failed';
  else if (statuses.every((status) => ['completed', 'blocked', 'cancelled'].includes(status)) && statuses.some((status) => status === 'blocked')) plan.status = 'failed';
  else if (statuses.some((status) => status === 'running')) plan.status = 'running';
  else plan.status = 'pending';
  return plan.status;
}

async function executePlan(plan, executor, options = {}) {
  if (typeof executor !== 'function') throw new Error('Executor obbligatorio');
  while (!TERMINAL.has(refreshPlanStatus(plan))) {
    if (options.signal?.aborted) {
      cancelPlan(plan);
      break;
    }
    const step = nextRunnable(plan);
    if (!step) {
      refreshPlanStatus(plan);
      break;
    }
    let approvedHash = null;
    if (step.approvalRequired && typeof options.approve === 'function') approvedHash = await options.approve({ plan, step, approvalHash: approvalHash(plan, step) });
    startStep(plan, step.id, approvedHash);
    try {
      const result = await executor({ plan, step, attempt: plan.state[step.id].attempts });
      completeStep(plan, step.id, result);
    } catch (error) {
      const retrying = failStep(plan, step.id, error);
      if (retrying && typeof options.onRetry === 'function') await options.onRetry({ plan, step, error, attempt: plan.state[step.id].attempts });
    }
  }
  return plan;
}

module.exports = {
  createPlan,
  nextRunnable,
  startStep,
  completeStep,
  failStep,
  cancelPlan,
  refreshPlanStatus,
  approvalHash,
  executePlan
};
