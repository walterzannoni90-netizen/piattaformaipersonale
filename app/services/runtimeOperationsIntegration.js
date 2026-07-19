'use strict';

const os = require('os');
const { routeTaskExecution } = require('./runtimeCanaryRouter');
const { runDurableTask } = require('./runtimeCoordinator');
const {
  inspectUntrustedWebContent,
  wrapUntrustedEvidence,
  RuntimeTelemetry,
  TaskLeaseManager,
  runBenchmarkSuite
} = require('./multiTrackHardening');

function createWorkerId(prefix = 'wes-worker') {
  return `${prefix}:${os.hostname()}:${process.pid}`;
}

function sanitizeEvidence(value) {
  const inspection = inspectUntrustedWebContent(value);
  return {
    inspection,
    evidence: wrapUntrustedEvidence(value),
    blocked: inspection.risk === 'high'
  };
}

function createLeaseHeartbeat(lease, taskId, intervalMs) {
  const timer = setInterval(() => {
    try { lease.heartbeat(taskId); } catch {}
  }, Math.max(1000, Number(intervalMs) || 10_000));
  timer.unref?.();
  return () => clearInterval(timer);
}

async function executeTaskWithOperations({
  db,
  task,
  legacyRunner,
  durableOptions = {},
  runtimeMode,
  canaryPercent,
  telemetrySink,
  workerId = createWorkerId(),
  leaseTtlMs = 30_000,
  heartbeatMs = 10_000,
  isEligible
} = {}) {
  if (!db || typeof db.prepare !== 'function') throw new Error('Database obbligatorio');
  if (!task?.id) throw new Error('Task obbligatorio');
  if (typeof legacyRunner !== 'function') throw new Error('Legacy runner obbligatorio');

  const telemetry = new RuntimeTelemetry({ sink: telemetrySink });
  const lease = new TaskLeaseManager({ db, ownerId: workerId, ttlMs: leaseTtlMs });
  if (!lease.acquire(task.id)) {
    await telemetry.record('task_lease_rejected', { taskId: task.id, workerId });
    const error = new Error('Task già in esecuzione da un altro worker');
    error.code = 'TASK_LEASE_CONFLICT';
    throw error;
  }

  await telemetry.record('task_lease_acquired', { taskId: task.id, workerId });
  const stopHeartbeat = createLeaseHeartbeat(lease, task.id, heartbeatMs);

  try {
    return await routeTaskExecution({
      task,
      legacyRunner: async (context) => {
        await telemetry.record('runtime_legacy_started', { taskId: task.id, reason: context?.decision?.reason });
        const result = await legacyRunner(context);
        await telemetry.record('runtime_legacy_completed', { taskId: task.id });
        return result;
      },
      durableRunner: async ({ recordEvent, decision }) => {
        await telemetry.record('runtime_durable_started', { taskId: task.id, reason: decision.reason });
        const result = await runDurableTask({
          db,
          task,
          ...durableOptions,
          onEvent: async (event) => {
            recordEvent(event);
            await telemetry.record('runtime_event', { taskId: task.id, eventType: event?.type || 'unknown' });
            if (typeof durableOptions.onEvent === 'function') await durableOptions.onEvent(event);
          }
        });
        await telemetry.record('runtime_durable_completed', { taskId: task.id, status: result.status, delivered: result.delivered });
        return result;
      },
      mode: runtimeMode,
      canaryPercent,
      isEligible,
      onDecision: (decision) => telemetry.record('runtime_decision', decision),
      onFallback: ({ error }) => telemetry.record('runtime_fallback', { taskId: task.id, code: error?.code || 'UNKNOWN' })
    });
  } catch (error) {
    await telemetry.record('task_execution_failed', { taskId: task.id, code: error?.code || 'UNKNOWN', message: String(error?.message || error) });
    throw error;
  } finally {
    stopHeartbeat();
    const released = lease.release(task.id);
    await telemetry.record('task_lease_released', { taskId: task.id, workerId, released });
  }
}

async function benchmarkRuntimeCases(cases, executor, options = {}) {
  return runBenchmarkSuite(cases, async (testCase) => {
    const started = Date.now();
    const output = await executor(testCase);
    return {
      output,
      runtimeMs: Date.now() - started,
      status: output?.status || 'unknown',
      delivered: Boolean(output?.delivered)
    };
  }, options);
}

module.exports = {
  createWorkerId,
  sanitizeEvidence,
  createLeaseHeartbeat,
  executeTaskWithOperations,
  benchmarkRuntimeCases
};