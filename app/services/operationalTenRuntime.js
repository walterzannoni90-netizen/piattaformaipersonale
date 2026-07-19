'use strict';

const crypto = require('crypto');

const OPERATIONAL_TRACKS = Object.freeze([
  'browser-session',
  'repository-change',
  'semantic-memory',
  'adaptive-improvement',
  'strategic-execution',
  'tool-discovery',
  'live-observability',
  'distributed-placement',
  'continuous-regression',
  'release-readiness'
]);

function createRunId(goal = '') {
  return crypto.createHash('sha256').update(`${Date.now()}:${goal}`).digest('hex').slice(0, 24);
}

class OperationalTenRuntime {
  constructor({ handlers = {}, telemetry, checkpointStore, concurrency = 10 } = {}) {
    this.handlers = new Map(Object.entries(handlers));
    this.telemetry = telemetry;
    this.checkpointStore = checkpointStore;
    this.concurrency = Math.max(1, Math.min(10, Number(concurrency) || 10));
  }

  health() {
    const registered = OPERATIONAL_TRACKS.filter((track) => typeof this.handlers.get(track) === 'function');
    return { ready: registered.length === OPERATIONAL_TRACKS.length, registered: registered.length, required: OPERATIONAL_TRACKS.length };
  }

  async execute(context = {}) {
    const runId = context.runId || createRunId(context.goal);
    const results = new Array(OPERATIONAL_TRACKS.length);
    let cursor = 0;
    await this.emit('operational.started', { runId, tracks: OPERATIONAL_TRACKS.length });

    const workers = Array.from({ length: this.concurrency }, async () => {
      while (true) {
        const index = cursor++;
        if (index >= OPERATIONAL_TRACKS.length) return;
        const track = OPERATIONAL_TRACKS[index];
        const startedAt = Date.now();
        try {
          const handler = this.handlers.get(track);
          if (typeof handler !== 'function') throw Object.assign(new Error(`Handler operativo mancante: ${track}`), { code: 'OPERATIONAL_HANDLER_MISSING' });
          const value = await handler({ ...context, runId, track });
          results[index] = { track, status: value?.status || 'completed', output: value?.output ?? value, durationMs: Date.now() - startedAt };
        } catch (error) {
          results[index] = { track, status: 'failed', error: error.message, code: error.code || 'OPERATIONAL_TRACK_FAILED', durationMs: Date.now() - startedAt };
        }
        await this.checkpointStore?.save?.({ runId, track, result: results[index] });
        await this.emit('operational.track.completed', { runId, ...results[index] });
      }
    });

    await Promise.all(workers);
    const summary = {
      requested: OPERATIONAL_TRACKS.length,
      completed: results.filter((item) => item?.status === 'completed').length,
      failed: results.filter((item) => item?.status === 'failed').length,
      blocked: results.filter((item) => item?.status === 'blocked').length
    };
    const complete = summary.completed === OPERATIONAL_TRACKS.length;
    await this.emit('operational.completed', { runId, summary, complete });
    return { runId, results, summary, complete };
  }

  async emit(type, payload) {
    await this.telemetry?.record?.({ type, ...payload, at: new Date().toISOString() });
  }
}

module.exports = { OPERATIONAL_TRACKS, OperationalTenRuntime, createRunId };
