'use strict';

const crypto = require('crypto');
const openManusClient = require('./openManusClient');

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const state = {
  consecutiveFailures: 0,
  circuitOpenedAt: 0,
  health: null,
  healthCheckedAt: 0,
  metrics: {
    submitted: 0,
    completed: 0,
    failed: 0,
    cancelled: 0,
    fallbacks: 0,
    circuitRejects: 0
  }
};

function numberEnv(name, fallback, minimum = 0) {
  const value = Number(process.env[name]);
  return Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}

function configuration() {
  const mode = String(process.env.OPENMANUS_RUNTIME_MODE || 'disabled').toLowerCase();
  return {
    mode: ['disabled', 'shadow', 'canary', 'primary'].includes(mode) ? mode : 'disabled',
    canaryPercent: Math.min(100, numberEnv('OPENMANUS_CANARY_PERCENT', 10, 0)),
    failureThreshold: numberEnv('OPENMANUS_CIRCUIT_FAILURES', 3, 1),
    circuitResetMs: numberEnv('OPENMANUS_CIRCUIT_RESET_MS', 60_000, 1_000),
    healthTtlMs: numberEnv('OPENMANUS_HEALTH_TTL_MS', 10_000, 500)
  };
}

function stableBucket(value) {
  const digest = crypto.createHash('sha256').update(String(value || '')).digest();
  return digest.readUInt32BE(0) % 100;
}

function idempotencyKey({ taskId, prompt, userId }) {
  return crypto.createHash('sha256')
    .update(`${taskId || ''}:${userId || ''}:${prompt || ''}`)
    .digest('hex');
}

function shouldDelegate({ taskId, mode } = {}) {
  const config = configuration();
  if (config.mode === 'disabled') return false;
  if (config.mode === 'primary' || config.mode === 'shadow') return true;
  const selectedMode = mode || 'autonomous';
  return selectedMode !== 'team' && stableBucket(taskId) < config.canaryPercent;
}

function circuitOpen(now = Date.now()) {
  const config = configuration();
  if (!state.circuitOpenedAt) return false;
  if (now - state.circuitOpenedAt >= config.circuitResetMs) {
    state.circuitOpenedAt = 0;
    state.consecutiveFailures = 0;
    return false;
  }
  return true;
}

function recordSuccess() {
  state.consecutiveFailures = 0;
  state.circuitOpenedAt = 0;
}

function recordFailure() {
  const config = configuration();
  state.consecutiveFailures += 1;
  if (state.consecutiveFailures >= config.failureThreshold) state.circuitOpenedAt = Date.now();
}

async function health({ force = false, signal } = {}) {
  const config = configuration();
  if (!force && state.health && Date.now() - state.healthCheckedAt < config.healthTtlMs) return state.health;
  try {
    const result = await openManusClient.health({ signal });
    state.health = result;
    state.healthCheckedAt = Date.now();
    if (result.openmanus_ready === false || result.status === 'degraded') recordFailure();
    else recordSuccess();
    return result;
  } catch (error) {
    state.health = { status: 'unavailable', openmanus_ready: false, error: error.message };
    state.healthCheckedAt = Date.now();
    recordFailure();
    return state.health;
  }
}

function normalizeProgress(task) {
  const status = String(task?.status || 'queued');
  const progressByStatus = { queued: 5, running: 50, completed: 100, failed: 100, cancelled: 100 };
  return {
    id: task?.id || null,
    status,
    progress: Number(task?.progress ?? progressByStatus[status] ?? 0),
    terminal: TERMINAL.has(status),
    error: task?.error || null,
    updatedAt: task?.updated_at || null
  };
}

function fallbackAllowed(error) {
  return ['OPENMANUS_UNAVAILABLE', 'OPENMANUS_TIMEOUT', 'OPENMANUS_TASK_TIMEOUT', 'OPENMANUS_HTTP_502', 'OPENMANUS_HTTP_503'].includes(error?.code);
}

async function run({ taskId, userId, prompt, mode = 'autonomous', metadata = {}, signal, onUpdate, fallback } = {}) {
  const config = configuration();
  if (!shouldDelegate({ taskId, mode })) return fallback ? fallback({ reason: 'routing_disabled' }) : null;
  if (circuitOpen()) {
    state.metrics.circuitRejects += 1;
    state.metrics.fallbacks += 1;
    return fallback ? fallback({ reason: 'circuit_open' }) : null;
  }

  const readiness = await health({ signal });
  if (readiness.openmanus_ready === false) {
    state.metrics.fallbacks += 1;
    return fallback ? fallback({ reason: 'engine_unavailable', health: readiness }) : null;
  }

  state.metrics.submitted += 1;
  try {
    const result = await openManusClient.runTask({
      prompt,
      metadata: {
        ...metadata,
        wes_task_id: taskId,
        wes_user_id: userId,
        idempotency_key: idempotencyKey({ taskId, prompt, userId }),
        runtime_mode: config.mode
      },
      signal,
      onUpdate: (task) => onUpdate?.(normalizeProgress(task), task)
    });
    recordSuccess();
    state.metrics[result.status] = (state.metrics[result.status] || 0) + 1;
    return { delegated: true, task: result, normalized: normalizeProgress(result) };
  } catch (error) {
    recordFailure();
    state.metrics.failed += 1;
    if (fallback && fallbackAllowed(error)) {
      state.metrics.fallbacks += 1;
      return fallback({ reason: 'recoverable_error', error });
    }
    throw error;
  }
}

function metrics() {
  return {
    ...state.metrics,
    consecutiveFailures: state.consecutiveFailures,
    circuitOpen: circuitOpen(),
    lastHealth: state.health,
    lastHealthCheckedAt: state.healthCheckedAt
  };
}

function resetForTests() {
  state.consecutiveFailures = 0;
  state.circuitOpenedAt = 0;
  state.health = null;
  state.healthCheckedAt = 0;
  Object.keys(state.metrics).forEach((key) => { state.metrics[key] = 0; });
}

module.exports = {
  configuration,
  stableBucket,
  idempotencyKey,
  shouldDelegate,
  circuitOpen,
  health,
  normalizeProgress,
  fallbackAllowed,
  run,
  metrics,
  resetForTests
};
