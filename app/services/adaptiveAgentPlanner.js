'use strict';

const crypto = require('crypto');

function clean(value, max = 2000) {
  return String(value || '').replace(/[\u0000-\u001F]/g, '').trim().slice(0, max);
}

function idFor(seed) {
  return crypto.createHash('sha256').update(seed).digest('hex').slice(0, 16);
}

function normalizeTask(task, index = 0, parentId = null) {
  const title = clean(task?.title || task?.action || `Task ${index + 1}`, 180);
  if (!title) throw new Error('Titolo task obbligatorio');
  const id = clean(task?.id, 80) || `task-${idFor(`${parentId || 'root'}:${index}:${title}`)}`;
  return {
    id,
    parentId,
    title,
    action: clean(task?.action || 'reason', 80),
    input: task?.input && typeof task.input === 'object' && !Array.isArray(task.input) ? { ...task.input } : {},
    dependencies: Array.isArray(task?.dependencies) ? [...new Set(task.dependencies.map((value) => clean(value, 80)).filter(Boolean))] : [],
    priority: Number.isFinite(task?.priority) ? Number(task.priority) : index,
    estimatedCost: Math.max(0, Number(task?.estimatedCost) || 0),
    maxAttempts: Math.max(1, Math.min(10, Number(task?.maxAttempts) || 3)),
    successCriteria: Array.isArray(task?.successCriteria) ? task.successCriteria.map((value) => clean(value, 500)).filter(Boolean) : [],
    metadata: task?.metadata && typeof task.metadata === 'object' ? { ...task.metadata } : {}
  };
}

function validateAcyclic(tasks) {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  if (byId.size !== tasks.length) throw new Error('ID task duplicato');
  const visiting = new Set();
  const visited = new Set();

  function visit(id) {
    if (visiting.has(id)) throw new Error('Il piano contiene un ciclo');
    if (visited.has(id)) return;
    const task = byId.get(id);
    if (!task) throw new Error(`Task non trovato: ${id}`);
    visiting.add(id);
    for (const dependency of task.dependencies) {
      if (!byId.has(dependency)) throw new Error(`Dipendenza sconosciuta: ${dependency}`);
      visit(dependency);
    }
    visiting.delete(id);
    visited.add(id);
  }

  for (const task of tasks) visit(task.id);
}

function createHierarchicalPlan({ goal, tasks = [], metadata = {} } = {}) {
  const normalizedGoal = clean(goal, 4000);
  if (!normalizedGoal) throw new Error('Obiettivo obbligatorio');
  if (!Array.isArray(tasks) || tasks.length === 0) throw new Error('Almeno un task è obbligatorio');
  if (tasks.length > 100) throw new Error('Troppi task nel piano');

  const normalized = tasks.map((task, index) => normalizeTask(task, index, task?.parentId || null));
  validateAcyclic(normalized);
  return {
    id: `plan-${idFor(`${normalizedGoal}:${JSON.stringify(normalized)}`)}`,
    goal: normalizedGoal,
    revision: 1,
    tasks: normalized,
    metadata: { ...metadata },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function expandTask(plan, taskId, children = []) {
  if (!plan?.tasks) throw new Error('Piano non valido');
  const parent = plan.tasks.find((task) => task.id === taskId);
  if (!parent) throw new Error('Task padre non trovato');
  if (!Array.isArray(children) || children.length === 0) throw new Error('Sotto-task obbligatori');

  const existingIds = new Set(plan.tasks.map((task) => task.id));
  const normalizedChildren = children.map((child, index) => normalizeTask(child, index, parent.id));
  for (const child of normalizedChildren) {
    if (existingIds.has(child.id)) throw new Error(`ID task duplicato: ${child.id}`);
    existingIds.add(child.id);
  }

  plan.tasks.push(...normalizedChildren);
  plan.revision += 1;
  plan.updatedAt = new Date().toISOString();
  validateAcyclic(plan.tasks);
  return normalizedChildren;
}

function reprioritize(plan, observations = {}) {
  if (!plan?.tasks) throw new Error('Piano non valido');
  const failed = new Set(observations.failedTaskIds || []);
  const blocked = new Set(observations.blockedTaskIds || []);
  const critical = new Set(observations.criticalTaskIds || []);

  for (const task of plan.tasks) {
    let score = Number(task.priority) || 0;
    if (critical.has(task.id)) score -= 100;
    if (failed.has(task.id)) score -= 25;
    if (blocked.has(task.id)) score += 50;
    if (task.dependencies.some((dependency) => failed.has(dependency))) score += 30;
    task.priority = score;
  }

  plan.tasks.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
  plan.revision += 1;
  plan.updatedAt = new Date().toISOString();
  return plan;
}

function proposeRecovery(plan, failure = {}) {
  if (!plan?.tasks) throw new Error('Piano non valido');
  const task = plan.tasks.find((item) => item.id === failure.taskId);
  if (!task) throw new Error('Task fallito non trovato');
  const code = clean(failure.code || 'ERROR', 80);
  const attempts = Math.max(0, Number(failure.attempts) || 0);

  if (['AUTH_REQUIRED', 'CAPTCHA_REQUIRED', 'APPROVAL_REQUIRED'].includes(code)) {
    return { strategy: 'human_intervention', taskId: task.id, reason: code };
  }
  if (attempts < task.maxAttempts && ['ETIMEDOUT', 'ECONNRESET', 'RATE_LIMIT', 'TASK_LEASE_CONFLICT'].includes(code)) {
    return { strategy: 'retry', taskId: task.id, delayMs: Math.min(30000, 500 * (2 ** attempts)) };
  }
  if (task.metadata?.fallbackAction) {
    return {
      strategy: 'fallback',
      taskId: task.id,
      replacement: normalizeTask({
        title: `Fallback: ${task.title}`,
        action: task.metadata.fallbackAction,
        input: task.input,
        dependencies: task.dependencies,
        priority: task.priority - 1,
        maxAttempts: 2
      }, plan.tasks.length, task.parentId)
    };
  }
  return { strategy: 'replan', taskId: task.id, reason: code };
}

function detectExecutionLoop(history = [], { window = 8, maxRepeats = 3 } = {}) {
  if (!Array.isArray(history) || history.length < maxRepeats) return false;
  const recent = history.slice(-Math.max(window, maxRepeats));
  const fingerprints = recent.map((event) => idFor(JSON.stringify({
    taskId: event?.taskId,
    action: event?.action,
    code: event?.code,
    outcome: event?.outcome
  })));
  const counts = new Map();
  for (const fingerprint of fingerprints) counts.set(fingerprint, (counts.get(fingerprint) || 0) + 1);
  return [...counts.values()].some((count) => count >= maxRepeats);
}

module.exports = {
  createHierarchicalPlan,
  expandTask,
  reprioritize,
  proposeRecovery,
  detectExecutionLoop,
  validateAcyclic
};
