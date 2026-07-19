'use strict';

const os = require('os');
const { runDurableTask } = require('./runtimeCoordinator');
const { routeTaskExecution } = require('./runtimeCanaryRouter');
const {
  inspectUntrustedWebContent,
  wrapUntrustedEvidence,
  RuntimeTelemetry,
  TaskLeaseManager,
  runBenchmarkSuite
} = require('./multiTrackHardening');

function workerIdentity(prefix = 'wes-worker') {
  return `${prefix}:${os.hostname()}:${process.pid}`;
}

function guardWebResult(result) {
  if (result == null) return result;
  if (typeof result === 'string') return wrapUntrustedEvidence(result);
  if (Array.isArray(result)) return result.map(guardWebResult);
  if (typeof result !== 'object') return result;

  const copy = { ...result };
  for (const key of ['content', 'text', 'body', 'snippet', 'html']) {
    if (typeof copy[key] === 'string') copy[key] = wrapUntrustedEvidence(copy[key]);
  }
  if (Array.isArray(copy.results)) copy.results = copy.results.map(guardWebResult);
  return copy;
}

function protectWebHandlers(handlers = {}, { blockHighRisk = false } = {}) {
  const protectedHandlers = { ...handlers };
  for (const name of ['web_search', 'web_fetch', 'browser', 'browser_action']) {
    if (typeof handlers[name] !== 'function') continue;
    protectedHandlers[name] = async (...args) => {
      const result = await handlers[name](...args);
      const guarded = guardWebResult(result);
      const serialized = JSON.stringify(guarded);
      const inspection = inspectUntrustedWebContent(serialized);
      if (blockHighRisk && inspection.risk === 'high') {
        const error = new Error('Contenuto web ad alto rischio bloccato');
        error.code = 'WEB_PROMPT_INJECTION_BLOCKED';
        error.inspection = inspection;
        throw error;
      }
      return guarded;
    };
  }
  return protectedHandlers;
}

async function runOperationalTask({
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
  maxReplans,
  onDeliver,
  creditsUsed,
  leaseOwner = workerIdentity(),
  leaseTtlMs = 30_000,
  heartbeatMs = 10_000,
  blockHighRiskWeb = false,
  telemetrySink
} = {}) {
  if (!task?.id) throw new Error('Task obbligatorio');
  const telemetry = new RuntimeTelemetry({ sink: telemetrySink });
  const leases = new TaskLeaseManager({ db, ownerId: leaseOwner, ttlMs: leaseTtlMs });
  if (!leases.acquire(task.id)) {
    await telemetry.record('task_lease_rejected', { taskId: task.id, ownerId: leaseOwner });
    const error = new Error('Task già in esecuzione su un altro worker');
    error.code = 'TASK_LEASE_CONFLICT';
    throw error;
  }

  await telemetry.record('task_lease_acquired', { taskId: task.id, ownerId: leaseOwner });
  const timer = setInterval(() => {
    if (!leases.heartbeat(task.id)) telemetry.record('task_lease_lost', { taskId: task.id, ownerId: leaseOwner }).catch(() => {});
  }, Math.max(1000, Number(heartbeatMs) || 10_000));
  timer.unref?.();

  try {
    const guardedHandlers = protectWebHandlers(handlers, { blockHighRisk: blockHighRiskWeb });
    const result = await runDurableTask({
      db,
      task,
      legacyPlan,
      handlers: guardedHandlers,
      eventWriter,
      checkpoint,
      approve,
      replan,
      evaluate,
      memory,
      browser,
      onEvent: async (event) => {
        await telemetry.record(`runtime_${event?.type || 'event'}`, { taskId: task.id });
        if (typeof onEvent === 'function') await onEvent(event);
      },
      isCancelled,
      maxReplans,
      onDeliver,
      creditsUsed
    });
    await telemetry.record('task_finished', { taskId: task.id, status: result.status, delivered: Boolean(result.delivered) });
    return { ...result, telemetry: telemetry.snapshot() };
  } catch (error) {
    await telemetry.record('task_failed', { taskId: task.id, code: error.code || 'ERROR' });
    error.telemetry = telemetry.snapshot();
    throw error;
  } finally {
    clearInterval(timer);
    leases.release(task.id);
    await telemetry.record('task_lease_released', { taskId: task.id, ownerId: leaseOwner });
  }
}

async function runRoutedOperationalTask({
  task,
  legacyRunner,
  runtimeMode,
  canaryPercent,
  canarySalt,
  isEligible,
  telemetrySink,
  ...durableOptions
} = {}) {
  if (typeof legacyRunner !== 'function') throw new Error('Legacy runner obbligatorio');
  const routingTelemetry = new RuntimeTelemetry({ sink: telemetrySink });

  return routeTaskExecution({
    task,
    mode: runtimeMode,
    canaryPercent,
    salt: canarySalt,
    isEligible,
    legacyRunner: async (context) => {
      await routingTelemetry.record('routing_legacy_started', {
        taskId: task.id,
        reason: context?.decision?.reason,
        fallback: Boolean(context?.fallbackError)
      });
      const result = await legacyRunner(context);
      await routingTelemetry.record('routing_legacy_completed', { taskId: task.id });
      return result;
    },
    durableRunner: async ({ recordEvent, decision }) => {
      await routingTelemetry.record('routing_durable_started', { taskId: task.id, reason: decision.reason });
      const result = await runOperationalTask({
        task,
        telemetrySink: async (event) => {
          await routingTelemetry.record(event.type, event.data);
          if (typeof telemetrySink === 'function') await telemetrySink(event);
        },
        ...durableOptions,
        onEvent: async (event) => {
          recordEvent(event);
          if (typeof durableOptions.onEvent === 'function') await durableOptions.onEvent(event);
        }
      });
      await routingTelemetry.record('routing_durable_completed', {
        taskId: task.id,
        status: result.status,
        delivered: Boolean(result.delivered)
      });
      return result;
    },
    onDecision: (decision) => routingTelemetry.record('routing_decision', decision),
    onFallback: ({ error, events }) => routingTelemetry.record('routing_fallback', {
      taskId: task.id,
      code: error?.code || 'ERROR',
      observedEvents: events.length
    })
  });
}

async function benchmarkOperationalRunner(cases, runner, options = {}) {
  const report = await runBenchmarkSuite(cases, runner, options);
  return {
    ...report,
    generatedAt: new Date().toISOString(),
    schemaVersion: 1
  };
}

module.exports = {
  workerIdentity,
  guardWebResult,
  protectWebHandlers,
  runOperationalTask,
  runRoutedOperationalTask,
  benchmarkOperationalRunner
};