'use strict';

const crypto = require('crypto');

const CAPABILITY_TRACKS = Object.freeze([
  ['semantic-memory', 'Semantic Memory Agent'],
  ['self-reflection', 'Reflection Agent'],
  ['dynamic-replanning', 'Replanning Agent'],
  ['hierarchical-planning', 'Hierarchy Agent'],
  ['autonomous-browser', 'Browser Agent'],
  ['autonomous-terminal', 'Terminal Agent'],
  ['autonomous-code-editing', 'Code Agent'],
  ['automatic-testing', 'Test Agent'],
  ['isolated-sandbox', 'Sandbox Agent'],
  ['long-running-tasks', 'Continuity Agent'],
  ['experience-learning', 'Learning Agent'],
  ['agent-benchmarks', 'Benchmark Agent'],
  ['dynamic-plugins', 'Plugin Agent'],
  ['multi-objective-planning', 'Objectives Agent'],
  ['observability-dashboard', 'Observability Agent'],
  ['cost-time-token-optimization', 'Efficiency Agent']
].map(([id, owner], index) => ({ id, owner, ordinal: index + 3 })));

function stableId(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20);
}

function normalizeResult(track, result, startedAt) {
  const status = result?.status || 'completed';
  return {
    trackId: track.id,
    owner: track.owner,
    status,
    output: result?.output ?? result,
    metrics: result?.metrics || {},
    durationMs: Date.now() - startedAt
  };
}

class ParallelCapabilityProgram {
  constructor({ handlers = {}, memory, telemetry, concurrency = 16, failFast = false } = {}) {
    this.handlers = new Map(Object.entries(handlers));
    this.memory = memory;
    this.telemetry = telemetry;
    this.concurrency = Math.max(1, Math.min(16, Number(concurrency) || 16));
    this.failFast = failFast;
  }

  register(trackId, handler) {
    if (!CAPABILITY_TRACKS.some((track) => track.id === trackId)) throw new Error(`Track sconosciuto: ${trackId}`);
    if (typeof handler !== 'function') throw new Error('Handler non valido');
    this.handlers.set(trackId, handler);
    return this;
  }

  async run(context = {}) {
    const programId = context.programId || stableId({ at: Date.now(), goal: context.goal });
    const queue = [...CAPABILITY_TRACKS];
    const results = new Array(queue.length);
    let cursor = 0;
    let aborted = false;

    await this.emit('program.started', { programId, tracks: queue.length, goal: context.goal || null });
    const workers = Array.from({ length: Math.min(this.concurrency, queue.length) }, async () => {
      while (!aborted) {
        const index = cursor++;
        if (index >= queue.length) return;
        const track = queue[index];
        const startedAt = Date.now();
        await this.emit('track.started', { programId, trackId: track.id, owner: track.owner });
        try {
          const handler = this.handlers.get(track.id) || this.defaultHandler.bind(this);
          const result = await handler({ ...context, programId, track });
          results[index] = normalizeResult(track, result, startedAt);
          await this.emit('track.completed', { programId, ...results[index] });
        } catch (error) {
          results[index] = {
            trackId: track.id,
            owner: track.owner,
            status: 'failed',
            error: error.message,
            code: error.code || 'CAPABILITY_TRACK_FAILED',
            durationMs: Date.now() - startedAt
          };
          await this.emit('track.failed', { programId, ...results[index] });
          if (this.failFast) aborted = true;
        }
      }
    });

    await Promise.all(workers);
    const summary = {
      requested: CAPABILITY_TRACKS.length,
      completed: results.filter((item) => item?.status === 'completed').length,
      failed: results.filter((item) => item?.status === 'failed').length,
      partial: results.filter((item) => item?.status === 'partial').length
    };
    await this.emit('program.completed', { programId, summary });
    return { programId, tracks: results, summary, complete: summary.completed === CAPABILITY_TRACKS.length };
  }

  async defaultHandler({ track }) {
    return {
      status: 'partial',
      output: {
        capability: track.id,
        owner: track.owner,
        message: 'Contratto attivo; collegare l’adapter operativo specifico.'
      }
    };
  }

  async emit(type, payload) {
    await this.telemetry?.record?.({ type, ...payload, at: new Date().toISOString() });
    await this.memory?.appendEvent?.({ type, payload, at: new Date().toISOString() });
  }
}

module.exports = { CAPABILITY_TRACKS, ParallelCapabilityProgram, stableId };
