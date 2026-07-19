'use strict';

const crypto = require('crypto');

const TERMINAL_WITH_SIDE_EFFECT_RISK = new Set([
  'external_action_started',
  'external_action_completed',
  'external_action_uncertain',
  'delivery_claimed',
  'delivery_completed'
]);

function clampPercent(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(100, Math.round(number)));
}

function stableBucket(taskId, salt = 'wes-runtime-v2') {
  const digest = crypto.createHash('sha256').update(`${salt}:${String(taskId)}`).digest();
  return digest.readUInt32BE(0) % 100;
}

function normalizeMode(value) {
  const mode = String(value || 'legacy').trim().toLowerCase();
  return ['legacy', 'canary', 'durable'].includes(mode) ? mode : 'legacy';
}

function chooseRuntime(task, options = {}) {
  if (!task?.id) throw new Error('Task id obbligatorio');
  const mode = normalizeMode(options.mode ?? process.env.AGENT_RUNTIME_MODE);
  if (mode === 'legacy') return { runtime: 'legacy', reason: 'mode_legacy', bucket: null };
  if (mode === 'durable') return { runtime: 'durable', reason: 'mode_durable', bucket: null };

  const percent = clampPercent(options.canaryPercent ?? process.env.AGENT_RUNTIME_CANARY_PERCENT);
  const bucket = stableBucket(task.id, options.salt);
  const eligible = options.isEligible ? Boolean(options.isEligible(task)) : true;
  return eligible && bucket < percent
    ? { runtime: 'durable', reason: 'canary_selected', bucket, percent }
    : { runtime: 'legacy', reason: eligible ? 'canary_not_selected' : 'task_not_eligible', bucket, percent };
}

function hasIrreversibleProgress(events = []) {
  return events.some((event) => {
    const type = typeof event === 'string' ? event : event?.type;
    return TERMINAL_WITH_SIDE_EFFECT_RISK.has(type);
  });
}

function canFallbackToLegacy({ error, events = [], durableStarted = false } = {}) {
  if (!error) return false;
  if (hasIrreversibleProgress(events)) return false;
  if (error.code === 'EXTERNAL_ACTION_UNCERTAIN') return false;
  if (error.code === 'APPROVAL_REQUIRED') return false;
  if (error.code === 'TASK_CANCELLED') return false;
  return durableStarted !== true || error.code === 'RUNTIME_BOOTSTRAP_FAILED';
}

async function routeTaskExecution({
  task,
  legacyRunner,
  durableRunner,
  mode,
  canaryPercent,
  salt,
  isEligible,
  onDecision,
  onFallback
} = {}) {
  if (typeof legacyRunner !== 'function') throw new Error('Legacy runner obbligatorio');
  if (typeof durableRunner !== 'function') throw new Error('Durable runner obbligatorio');

  const decision = chooseRuntime(task, { mode, canaryPercent, salt, isEligible });
  if (typeof onDecision === 'function') await onDecision({ task, ...decision });
  if (decision.runtime === 'legacy') return legacyRunner({ task, decision });

  const observedEvents = [];
  let durableStarted = false;
  try {
    return await durableRunner({
      task,
      decision,
      recordEvent(event) {
        durableStarted = true;
        observedEvents.push(event);
      }
    });
  } catch (error) {
    const fallback = canFallbackToLegacy({ error, events: observedEvents, durableStarted });
    if (!fallback) throw error;
    if (typeof onFallback === 'function') {
      await onFallback({ task, decision, error, events: observedEvents.slice() });
    }
    return legacyRunner({ task, decision: { ...decision, runtime: 'legacy', reason: 'durable_bootstrap_fallback' }, fallbackError: error });
  }
}

module.exports = {
  TERMINAL_WITH_SIDE_EFFECT_RISK,
  clampPercent,
  stableBucket,
  normalizeMode,
  chooseRuntime,
  hasIrreversibleProgress,
  canFallbackToLegacy,
  routeTaskExecution
};
