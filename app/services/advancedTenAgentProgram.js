'use strict';

const crypto = require('crypto');

const ADVANCED_TRACKS = Object.freeze([
  ['browser-autonomy', 'Browser Autonomy Agent'],
  ['codebase-autonomy', 'Codebase Autonomy Agent'],
  ['knowledge-graph', 'Knowledge Graph Agent'],
  ['self-improvement', 'Self Improvement Agent'],
  ['strategic-planning', 'Strategic Planning Agent'],
  ['tool-ecosystem', 'Tool Ecosystem Agent'],
  ['production-dashboard', 'Dashboard Agent'],
  ['distributed-runtime', 'Distributed Runtime Agent'],
  ['continuous-evaluation', 'Evaluation Agent'],
  ['product-identity', 'Product Identity Agent']
].map(([id, owner], index) => ({ id, owner, ordinal: index + 1 }));

function makeRunId(goal) {
  return crypto.createHash('sha256').update(`${Date.now()}:${goal || ''}`).digest('hex').slice(0, 24);
}

class AdvancedTenAgentProgram {
  constructor({ handlers = {}, telemetry, memory, concurrency = 10, failFast = false } = {}) {
    this.handlers = new Map(Object.entries(handlers));
    this.telemetry = telemetry;
    this.memory = memory;
    this.concurrency = Math.max(1, Math.min(10, Number(concurrency) || 10));
    this.failFast = failFast;
  }

  register(trackId, handler) {
    if (!ADVANCED_TRACKS.some((track) => track.id === trackId)) throw new Error(`Track sconosciuto: ${trackId}`);
    if (typeof handler !== 'function') throw new Error('Handler non valido');
    this.handlers.set(trackId, handler);
    return this;
  }

  async run(context = {}) {
    const runId = context.runId || makeRunId(context.goal);
    const results = new Array(ADVANCED_TRACKS.length);
    let cursor = 0;
    let stopped = false;
    await this.emit('advanced-program.started', { runId, goal: context.goal || null, tracks: ADVANCED_TRACKS.length });

    const workers = Array.from({ length: this.concurrency }, async () => {
      while (!stopped) {
        const index = cursor++;
        if (index >= ADVANCED_TRACKS.length) return;
        const track = ADVANCED_TRACKS[index];
        const startedAt = Date.now();
        await this.emit('advanced-track.started', { runId, trackId: track.id, owner: track.owner });
        try {
          const handler = this.handlers.get(track.id);
          if (typeof handler !== 'function') throw Object.assign(new Error(`Adapter mancante: ${track.id}`), { code: 'ADVANCED_ADAPTER_MISSING' });
          const value = await handler({ ...context, runId, track });
          results[index] = {
            trackId: track.id,
            owner: track.owner,
            status: value?.status || 'completed',
            output: value?.output ?? value,
            metrics: value?.metrics || {},
            durationMs: Date.now() - startedAt
          };
          await this.emit('advanced-track.completed', { runId, ...results[index] });
        } catch (error) {
          results[index] = {
            trackId: track.id,
            owner: track.owner,
            status: 'failed',
            error: error.message,
            code: error.code || 'ADVANCED_TRACK_FAILED',
            durationMs: Date.now() - startedAt
          };
          await this.emit('advanced-track.failed', { runId, ...results[index] });
          if (this.failFast) stopped = true;
        }
      }
    });

    await Promise.all(workers);
    const summary = {
      requested: ADVANCED_TRACKS.length,
      completed: results.filter((item) => item?.status === 'completed').length,
      failed: results.filter((item) => item?.status === 'failed').length,
      partial: results.filter((item) => item?.status === 'partial').length
    };
    await this.emit('advanced-program.completed', { runId, summary });
    return { runId, tracks: results, summary, complete: summary.completed === ADVANCED_TRACKS.length };
  }

  async emit(type, payload) {
    const event = { type, ...payload, at: new Date().toISOString() };
    await this.telemetry?.record?.(event);
    await this.memory?.appendEvent?.({ type, payload, at: event.at });
  }
}

module.exports = { ADVANCED_TRACKS, AdvancedTenAgentProgram, makeRunId };