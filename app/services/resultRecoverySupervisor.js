'use strict';

const TRANSIENT_CODES = new Set(['TOOL_TIMEOUT', 'ETIMEDOUT', 'ECONNRESET', 'RATE_LIMIT', 'TEMPORARY_UNAVAILABLE']);

function scoreResult({ result, assertions = [] } = {}) {
  const checks = assertions.map((assertion) => {
    try {
      const passed = typeof assertion.test === 'function' ? assertion.test(result) === true : false;
      return { id: assertion.id || 'assertion', passed, weight: Number(assertion.weight) || 1 };
    } catch (error) {
      return { id: assertion.id || 'assertion', passed: false, weight: Number(assertion.weight) || 1, error: error.message };
    }
  });
  const totalWeight = checks.reduce((sum, item) => sum + item.weight, 0);
  const passedWeight = checks.filter((item) => item.passed).reduce((sum, item) => sum + item.weight, 0);
  return { passed: checks.every((item) => item.passed), score: totalWeight ? passedWeight / totalWeight : 1, checks };
}

function chooseRecovery(error, context = {}) {
  const code = error?.code || 'ERROR';
  const attempt = Math.max(1, Number(context.attempt) || 1);
  const maxAttempts = Math.max(1, Number(context.maxAttempts) || 3);
  if (['approval_required', 'AUTH_REQUIRED', 'CAPTCHA_REQUIRED'].includes(code)) return { action: 'human', reason: code };
  if (code === 'VERIFICATION_FAILED' && attempt < maxAttempts) return { action: 'replan', reason: code };
  if (TRANSIENT_CODES.has(code) && attempt < maxAttempts) return { action: 'retry', reason: code, delayMs: Math.min(30_000, 500 * (2 ** (attempt - 1))) };
  if (context.fallbackToolId) return { action: 'fallback', reason: code, toolId: context.fallbackToolId };
  return { action: 'fail', reason: code };
}

class ResultRecoverySupervisor {
  constructor({ runtime, planner, memory, sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)) } = {}) {
    if (!runtime) throw new Error('Runtime obbligatorio');
    this.runtime = runtime;
    this.planner = planner;
    this.memory = memory;
    this.sleep = sleep;
  }

  async run(request, options = {}) {
    const maxAttempts = Math.max(1, Number(options.maxAttempts) || 3);
    let currentRequest = { ...request };
    const history = [];
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const execution = await this.runtime.execute(currentRequest);
        const evaluation = scoreResult({ result: execution.result, assertions: options.assertions || [] });
        history.push({ attempt, status: 'completed', evaluation });
        if (!evaluation.passed) {
          const error = Object.assign(new Error('Result assertions failed'), { code: 'VERIFICATION_FAILED', evaluation });
          throw error;
        }
        await this.memory?.appendEvent?.(options.memoryKey, { type: 'tool_execution_completed', attempt, executionId: execution.executionId });
        return { ...execution, evaluation, attempts: attempt, history };
      } catch (error) {
        const recovery = chooseRecovery(error, { attempt, maxAttempts, fallbackToolId: options.fallbackToolId });
        history.push({ attempt, status: 'failed', code: error.code || 'ERROR', recovery });
        await this.memory?.appendEvent?.(options.memoryKey, { type: 'tool_execution_failed', attempt, code: error.code || 'ERROR', recovery });
        if (recovery.action === 'retry') {
          await this.sleep(recovery.delayMs);
          continue;
        }
        if (recovery.action === 'fallback') {
          currentRequest = { ...currentRequest, toolId: recovery.toolId };
          continue;
        }
        if (recovery.action === 'replan' && typeof this.planner?.replan === 'function') {
          currentRequest = await this.planner.replan({ request: currentRequest, error, history });
          continue;
        }
        error.recovery = recovery;
        error.history = history;
        throw error;
      }
    }
    throw Object.assign(new Error('Tentativi esauriti'), { code: 'ATTEMPTS_EXHAUSTED', history });
  }
}

module.exports = { ResultRecoverySupervisor, scoreResult, chooseRecovery };