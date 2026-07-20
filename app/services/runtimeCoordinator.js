'use strict';

const { runUnifiedTaskRuntime } = require('./unifiedTaskRuntime');
const { RuntimePersistenceAdapter } = require('./runtimePersistenceAdapter');

function createAbortSignal(isCancelled, intervalMs = 250) {
  const controller = new AbortController();
  if (typeof isCancelled !== 'function') return { signal: controller.signal, dispose() {} };
  const timer = setInterval(() => {
    try {
      if (isCancelled()) controller.abort(new Error('TASK_CANCELLED'));
    } catch {
      controller.abort(new Error('TASK_CANCELLED'));
    }
  }, Math.max(50, Number(intervalMs) || 250));
  timer.unref?.();
  return { signal: controller.signal, dispose: () => clearInterval(timer) };
}

function extractDeliverable(plan) {
  if (!plan || !Array.isArray(plan.steps) || !plan.state) return '';
  for (const step of [...plan.steps].reverse()) {
    const result = plan.state[step.id]?.result;
    if (result && typeof result === 'object' && typeof result.deliverable === 'string') return result.deliverable;
  }
  return '';
}

async function runDurableTask({
  db,
  task,
  legacyPlan,
  handlers,
  eventWriter,
  checkpoint,
  approve,
  replan,
  evaluate,
  memory,
  browser,
  onEvent,
  isCancelled,
  maxReplans = 2,
  onDeliver,
  creditsUsed = null
} = {}) {
  if (!task?.id || !task?.user_id) throw new Error('Task completo obbligatorio');
  const persistence = new RuntimePersistenceAdapter({
    db,
    taskId: task.id,
    userId: task.user_id,
    eventWriter
  });
  const abort = createAbortSignal(isCancelled);
  try {
    const result = await runUnifiedTaskRuntime({
      task,
      legacyPlan,
      handlers,
      checkpoint: async (plan, event) => {
        // Il task non deve risultare "completed" prima della consegna
        // effettiva (artefatti, evento di delivery, memoria di progetto):
        // lo stato finale viene persistito solo da completeDelivery.
        const snapshot = event?.type === 'execution_completed' ? { ...plan, status: 'running' } : plan;
        persistence.save(snapshot, event);
        if (typeof checkpoint === 'function') await checkpoint(plan, event);
      },
      approve,
      replan,
      evaluate,
      memory,
      browser,
      onEvent,
      signal: abort.signal,
      maxReplans
    });

    if (result.status === 'cancelled') {
      persistence.markCancelled(result);
      return { status: 'cancelled', plan: result, delivered: false };
    }

    if (result.status !== 'completed') {
      return { status: result.status, plan: result, delivered: false };
    }

    const deliverable = extractDeliverable(result);
    if (!deliverable) {
      const error = new Error('Piano completato senza deliverable');
      error.code = 'DELIVERABLE_MISSING';
      throw error;
    }

    if (!persistence.claimDelivery(result)) {
      return { status: 'completed', plan: result, delivered: false, duplicate: true, deliverable };
    }

    if (typeof onDeliver === 'function') {
      await onDeliver({ task, plan: result, deliverable });
    }
    persistence.completeDelivery({ result: deliverable, creditsUsed });
    return { status: 'completed', plan: result, delivered: true, deliverable };
  } catch (error) {
    if (abort.signal.aborted || error?.code === 'TASK_CANCELLED') {
      const snapshot = persistence.load();
      if (snapshot) persistence.markCancelled(snapshot);
      return { status: 'cancelled', plan: snapshot, delivered: false };
    }
    throw error;
  } finally {
    abort.dispose();
  }
}

module.exports = { runDurableTask, createAbortSignal, extractDeliverable };