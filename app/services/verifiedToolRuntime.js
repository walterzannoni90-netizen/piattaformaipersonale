'use strict';

const crypto = require('crypto');

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function timeoutPromise(ms, signal) {
  return new Promise((_, reject) => {
    const timer = setTimeout(() => reject(Object.assign(new Error('Tool timeout'), { code: 'TOOL_TIMEOUT' })), ms);
    timer.unref?.();
    signal?.addEventListener?.('abort', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Execution aborted'), { code: 'ABORTED' }));
    }, { once: true });
  });
}

class VerifiedToolRuntime {
  constructor({ registry, handlers = {}, verifier, defaultTimeoutMs = 30_000, maxOutputBytes = 1_000_000 } = {}) {
    if (!registry) throw new Error('Tool registry obbligatorio');
    this.registry = registry;
    this.handlers = new Map(Object.entries(handlers));
    this.verifier = verifier;
    this.defaultTimeoutMs = Math.max(100, Number(defaultTimeoutMs) || 30_000);
    this.maxOutputBytes = Math.max(1024, Number(maxOutputBytes) || 1_000_000);
    this.inflight = new Map();
  }

  registerHandler(toolId, handler) {
    if (typeof handler !== 'function') throw new Error('Handler non valido');
    this.handlers.set(toolId, handler);
  }

  async execute(request = {}) {
    const authorization = this.registry.authorize(request);
    if (!authorization.allowed) {
      const error = new Error(`Tool negato: ${authorization.reason}`);
      error.code = authorization.reason;
      throw error;
    }
    const handler = this.handlers.get(request.toolId);
    if (!handler) throw Object.assign(new Error(`Handler mancante: ${request.toolId}`), { code: 'HANDLER_MISSING' });
    const executionId = request.executionId || hash({ request, at: Date.now() }).slice(0, 20);
    if (this.inflight.has(executionId)) throw Object.assign(new Error('Esecuzione duplicata'), { code: 'DUPLICATE_EXECUTION' });
    const startedAt = Date.now();
    this.inflight.set(executionId, { executionId, status: 'running', startedAt });
    try {
      const timeoutMs = Math.max(100, Number(request.timeoutMs) || this.defaultTimeoutMs);
      const result = await Promise.race([
        handler({ ...request, tool: authorization.tool }),
        timeoutPromise(timeoutMs, request.signal)
      ]);
      const serialized = JSON.stringify(result);
      if (Buffer.byteLength(serialized || '', 'utf8') > this.maxOutputBytes) {
        throw Object.assign(new Error('Output tool troppo grande'), { code: 'OUTPUT_LIMIT' });
      }
      const verification = await this.verify({ request, result, tool: authorization.tool });
      if (!verification.passed) {
        const error = new Error(verification.reason || 'Risultato non verificato');
        error.code = 'VERIFICATION_FAILED';
        error.verification = verification;
        throw error;
      }
      return { executionId, status: 'completed', result, verification, resultHash: hash(result), durationMs: Date.now() - startedAt };
    } finally {
      this.inflight.delete(executionId);
    }
  }

  async verify(context) {
    if (typeof this.verifier === 'function') {
      const verdict = await this.verifier(context);
      if (typeof verdict === 'boolean') return { passed: verdict, reason: verdict ? null : 'Verifier rejected result' };
      return { passed: verdict?.passed === true, reason: verdict?.reason || null, score: verdict?.score ?? null };
    }
    const result = context.result;
    const passed = result !== undefined && result !== null && !(result && result.success === false);
    return { passed, reason: passed ? null : 'Empty or unsuccessful result' };
  }
}

module.exports = { VerifiedToolRuntime, hash };