'use strict';

const {
  nextRunnable,
  startStep,
  completeStep,
  failStep,
  cancelPlan,
  refreshPlanStatus,
  approvalHash
} = require('./autonomousPlanner');

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function clean(value, max = 2000) {
  return String(value || '').replace(/[\u0000-\u001F]/g, '').trim().slice(0, max);
}

// Errori che non ha senso ritentare: la causa è esterna all'esecuzione
// (configurazione mancante, qualità insufficiente, stato esterno incerto).
const NON_RETRYABLE_CODES = new Set([
  'approval_required',
  'AI_NOT_CONFIGURED',
  'WEB_NOT_CONFIGURED',
  'CONNECTOR_NOT_CONFIGURED',
  'EXTERNAL_ACTION_UNCERTAIN',
  'QUALITY_CHECK_FAILED',
  'TASK_CANCELLED'
]);

// Errori per cui un piano correttivo automatico non può aiutare:
// richiedono un intervento umano o una configurazione, non un nuovo tentativo.
const NON_REPLANNABLE_CODES = new Set([
  'AI_NOT_CONFIGURED',
  'WEB_NOT_CONFIGURED',
  'CONNECTOR_NOT_CONFIGURED',
  'EXTERNAL_ACTION_UNCERTAIN',
  'QUALITY_CHECK_FAILED'
]);

function defaultRetryPolicy({ error, attempt, step }) {
  if (step.approvalRequired) return false;
  if (NON_RETRYABLE_CODES.has(error?.code)) return false;
  return attempt < step.maxAttempts;
}

function mergeReplan(plan, replacement) {
  if (!replacement || !Array.isArray(replacement.steps) || !replacement.state) throw new Error('Replanning non valido');
  if (replacement.id !== plan.id) throw new Error('Il replanning deve mantenere lo stesso task id');
  const completed = new Map(plan.steps
    .filter((step) => plan.state[step.id]?.status === 'completed')
    .map((step) => [step.id, clone(plan.state[step.id])]));
  for (const step of replacement.steps) {
    if (completed.has(step.id)) replacement.state[step.id] = completed.get(step.id);
  }
  replacement.metadata = {
    ...(replacement.metadata || {}),
    replannedAt: new Date().toISOString(),
    replanCount: Number(plan.metadata?.replanCount || 0) + 1
  };
  refreshPlanStatus(replacement);
  return replacement;
}

async function runResilientPlan({
  plan,
  execute,
  checkpoint,
  approve,
  replan,
  onEvent,
  retryPolicy = defaultRetryPolicy,
  signal,
  maxReplans = 2
}) {
  if (!plan || !Array.isArray(plan.steps) || !plan.state) throw new Error('Piano obbligatorio');
  if (typeof execute !== 'function') throw new Error('Executor obbligatorio');
  let activePlan = plan;
  let replans = Number(activePlan.metadata?.replanCount || 0);
  let lastFailure = null;

  const emit = async (type, payload = {}) => {
    const event = { type, at: new Date().toISOString(), plan: clone(activePlan), ...payload };
    if (typeof checkpoint === 'function') await checkpoint(event.plan, event);
    if (typeof onEvent === 'function') await onEvent(event);
  };

  await emit('execution_started');

  while (!TERMINAL.has(refreshPlanStatus(activePlan))) {
    if (signal?.aborted) {
      cancelPlan(activePlan);
      await emit('execution_cancelled');
      break;
    }

    const step = nextRunnable(activePlan);
    if (!step) {
      refreshPlanStatus(activePlan);
      break;
    }

    let approvedHash = null;
    if (step.approvalRequired) {
      const expected = approvalHash(activePlan, step);
      approvedHash = typeof approve === 'function'
        ? await approve({ plan: clone(activePlan), step, approvalHash: expected })
        : null;
    }

    try {
      startStep(activePlan, step.id, approvedHash);
      await emit('step_started', { step: clone(step), attempt: activePlan.state[step.id].attempts });
      const result = await execute({
        plan: clone(activePlan),
        step,
        attempt: activePlan.state[step.id].attempts,
        signal
      });
      completeStep(activePlan, step.id, result);
      await emit('step_completed', { step: clone(step), result });
    } catch (error) {
      if (error?.code === 'approval_required') {
        await emit('approval_required', { step: clone(step), approvalHash: error.approvalHash });
        return activePlan;
      }
      if (activePlan.state[step.id]?.status === 'running') failStep(activePlan, step.id, error);
      const attempt = activePlan.state[step.id]?.attempts || 0;
      const retry = retryPolicy({ error, attempt, step, plan: clone(activePlan) });
      if (retry && activePlan.state[step.id]?.status === 'failed') activePlan.state[step.id].status = 'pending';
      if (!retry) lastFailure = { message: clean(error?.message || error), code: error?.code || null };
      await emit(retry ? 'step_retry_scheduled' : 'step_failed', {
        step: clone(step),
        attempt,
        error: clean(error?.message || error),
        code: error?.code || null
      });

      if (!retry && typeof replan === 'function' && replans < maxReplans && !step.approvalRequired && !NON_REPLANNABLE_CODES.has(error?.code)) {
        const replacement = await replan({
          plan: clone(activePlan),
          failedStep: clone(step),
          error: { message: clean(error?.message || error), code: error?.code || null }
        });
        if (replacement) {
          activePlan = mergeReplan(activePlan, replacement);
          replans += 1;
          await emit('plan_replanned', { failedStep: clone(step), replanCount: replans });
        }
      }
    }
  }

  refreshPlanStatus(activePlan);
  await emit(`execution_${activePlan.status}`, activePlan.status === 'failed' && lastFailure
    ? { error: lastFailure.message, code: lastFailure.code }
    : {});
  return activePlan;
}

module.exports = {
  runResilientPlan,
  mergeReplan,
  defaultRetryPolicy,
  NON_RETRYABLE_CODES,
  NON_REPLANNABLE_CODES
};
