'use strict';

const { EventEmitter } = require('events');
const { ParallelCapabilityProgram } = require('./parallelCapabilityProgram');
const { createCapabilityAdapters } = require('./autonomousCapabilityAdapters');

const WORKSTREAMS = Object.freeze([
  'runtime-integration','browser-runtime','terminal-runtime','code-runtime','semantic-memory','self-improvement',
  'automatic-replanning','secure-sandbox','durable-resume','secure-plugins','live-observability','runtime-optimization'
]);

class ProductionAutonomyRuntime extends EventEmitter {
  constructor(deps = {}) {
    super();
    this.deps = deps;
    this.memory = deps.memory;
    this.telemetry = deps.telemetry;
    this.checkpoints = deps.checkpoints;
    this.optimizer = deps.optimizer;
    this.adapters = createCapabilityAdapters(deps);
    this.program = new ParallelCapabilityProgram({ handlers: this.adapters, memory: deps.memory, telemetry: deps.telemetry, concurrency: 12, failFast: false });
  }

  async execute(task, options = {}) {
    if (!task?.id || !task?.prompt) throw new Error('Task non valido');
    const startedAt = Date.now();
    const checkpoint = await this.checkpoints?.load?.(task.id);
    const selected = await this.optimizer?.select?.({ task, budget: options.budget || {} }) || null;
    await this.record('runtime.started', { taskId: task.id, resumed: Boolean(checkpoint) });
    const result = await this.program.run({ goal: task.prompt, task, checkpoint, selected, budget: options.budget || {}, permissions: options.permissions || {} });
    const complete = result.complete && result.summary.failed === 0 && result.summary.partial === 0;
    const final = { ...result, complete, selected, durationMs: Date.now() - startedAt };
    await this.checkpoints?.save?.(task.id, { state: complete ? 'completed' : 'incomplete', final });
    await this.record('runtime.completed', { taskId: task.id, complete, summary: result.summary, durationMs: final.durationMs });
    this.emit('completed', final);
    return final;
  }

  async resume(taskId, task, options = {}) {
    const checkpoint = await this.checkpoints?.load?.(taskId);
    if (!checkpoint) throw new Error(`Checkpoint non trovato: ${taskId}`);
    return this.execute({ ...task, id: taskId }, { ...options, executionId: `${taskId}:resume` });
  }

  async record(type, payload) {
    const event = { type, payload, at: new Date().toISOString() };
    await this.telemetry?.record?.(event);
    await this.memory?.appendEvent?.(event);
  }

  health() { return { status: 'ready', workstreams: WORKSTREAMS.length, concurrency: 12 }; }
}

module.exports = { ProductionAutonomyRuntime, WORKSTREAMS };
