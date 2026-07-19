'use strict';

const crypto = require('crypto');

function stableId(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

function normalizeGoal(goal) {
  const text = String(goal || '').trim();
  if (!text) throw new Error('Obiettivo obbligatorio');
  return text;
}

function buildExecutionGraph(goal, steps = []) {
  const normalizedGoal = normalizeGoal(goal);
  const nodes = steps.map((step, index) => ({
    id: step.id || `step-${index + 1}`,
    title: String(step.title || step.action || `Passo ${index + 1}`),
    action: step.action || 'reason',
    dependencies: Array.isArray(step.dependencies) ? [...new Set(step.dependencies)] : [],
    priority: Number.isFinite(step.priority) ? step.priority : index,
    status: 'pending',
    attempts: 0,
    maxAttempts: Math.max(1, Number(step.maxAttempts) || 3),
    input: step.input || null
  }));
  const ids = new Set(nodes.map((node) => node.id));
  for (const node of nodes) {
    for (const dependency of node.dependencies) {
      if (!ids.has(dependency)) throw new Error(`Dipendenza sconosciuta: ${dependency}`);
    }
  }
  return { id: stableId({ normalizedGoal, nodes }), goal: normalizedGoal, nodes, createdAt: new Date().toISOString() };
}

function selectReadyNodes(graph, concurrency = 3) {
  const completed = new Set(graph.nodes.filter((node) => node.status === 'completed').map((node) => node.id));
  return graph.nodes
    .filter((node) => node.status === 'pending' && node.dependencies.every((id) => completed.has(id)))
    .sort((a, b) => a.priority - b.priority)
    .slice(0, Math.max(1, Number(concurrency) || 1));
}

function createCheckpoint(graph, metadata = {}) {
  return {
    version: 1,
    graphId: graph.id,
    graph: JSON.parse(JSON.stringify(graph)),
    metadata: { ...metadata },
    checksum: stableId(graph),
    savedAt: new Date().toISOString()
  };
}

function restoreCheckpoint(checkpoint) {
  if (!checkpoint?.graph || !checkpoint.checksum) throw new Error('Checkpoint non valido');
  if (stableId(checkpoint.graph) !== checkpoint.checksum) throw new Error('Checkpoint corrotto');
  return JSON.parse(JSON.stringify(checkpoint.graph));
}

function classifyFailure(error) {
  const code = error?.code || 'ERROR';
  if (['ETIMEDOUT', 'ECONNRESET', 'RATE_LIMIT', 'TASK_LEASE_CONFLICT'].includes(code)) return 'transient';
  if (['APPROVAL_REQUIRED', 'AUTH_REQUIRED', 'CAPTCHA_REQUIRED'].includes(code)) return 'blocked';
  return 'permanent';
}

function computeRetryDelay(attempt, { baseMs = 500, maxMs = 30_000 } = {}) {
  const exponent = Math.max(0, Number(attempt) - 1);
  return Math.min(maxMs, baseMs * (2 ** exponent));
}

function evaluateCompletion(graph) {
  const failed = graph.nodes.filter((node) => node.status === 'failed');
  const blocked = graph.nodes.filter((node) => node.status === 'blocked');
  const completed = graph.nodes.filter((node) => node.status === 'completed');
  return {
    status: failed.length ? 'failed' : blocked.length ? 'blocked' : completed.length === graph.nodes.length ? 'completed' : 'running',
    progress: graph.nodes.length ? completed.length / graph.nodes.length : 1,
    completed: completed.length,
    total: graph.nodes.length,
    failed: failed.map((node) => node.id),
    blocked: blocked.map((node) => node.id)
  };
}

async function executeGraph({ graph, handlers = {}, concurrency = 3, checkpoint, onEvent, signal } = {}) {
  if (!graph?.nodes) throw new Error('Grafo obbligatorio');
  while (true) {
    if (signal?.aborted) return { graph, ...evaluateCompletion(graph), status: 'cancelled' };
    const summary = evaluateCompletion(graph);
    if (['completed', 'failed', 'blocked'].includes(summary.status)) return { graph, ...summary };
    const ready = selectReadyNodes(graph, concurrency);
    if (!ready.length) return { graph, ...summary, status: 'blocked', reason: 'NO_READY_NODES' };

    await Promise.all(ready.map(async (node) => {
      node.status = 'running';
      node.attempts += 1;
      await onEvent?.({ type: 'step_started', nodeId: node.id, attempt: node.attempts });
      try {
        const handler = handlers[node.action] || handlers.default;
        if (typeof handler !== 'function') throw Object.assign(new Error(`Handler mancante: ${node.action}`), { code: 'HANDLER_MISSING' });
        node.result = await handler({ node, graph, signal });
        node.status = 'completed';
        await onEvent?.({ type: 'step_completed', nodeId: node.id });
      } catch (error) {
        const failure = classifyFailure(error);
        node.error = { code: error.code || 'ERROR', message: error.message };
        if (failure === 'transient' && node.attempts < node.maxAttempts) {
          node.status = 'pending';
          node.retryAfterMs = computeRetryDelay(node.attempts);
        } else {
          node.status = failure === 'blocked' ? 'blocked' : 'failed';
        }
        await onEvent?.({ type: 'step_failed', nodeId: node.id, failure, code: node.error.code });
      }
    }));
    await checkpoint?.(createCheckpoint(graph, { summary: evaluateCompletion(graph) }));
  }
}

module.exports = {
  stableId,
  normalizeGoal,
  buildExecutionGraph,
  selectReadyNodes,
  createCheckpoint,
  restoreCheckpoint,
  classifyFailure,
  computeRetryDelay,
  evaluateCompletion,
  executeGraph
};
