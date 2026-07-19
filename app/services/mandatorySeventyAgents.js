'use strict';

const DOMAINS = Object.freeze({
  browser: ['navigation', 'session', 'forms', 'downloads', 'recovery', 'vision', 'compliance'],
  code: ['analysis', 'editing', 'testing', 'review', 'refactor', 'dependency', 'release'],
  memory: ['episodic', 'semantic', 'vector', 'graph', 'retention', 'retrieval', 'consolidation'],
  planning: ['decomposition', 'strategy', 'scheduling', 'replanning', 'constraints', 'verification', 'optimization'],
  tools: ['discovery', 'routing', 'permissions', 'sandbox', 'registry', 'health', 'fallback'],
  data: ['ingestion', 'validation', 'transformation', 'quality', 'lineage', 'privacy', 'export'],
  operations: ['telemetry', 'alerts', 'cost', 'capacity', 'checkpoint', 'recovery', 'dashboard'],
  security: ['identity', 'secrets', 'policy', 'audit', 'threat', 'isolation', 'approval'],
  evaluation: ['benchmark', 'regression', 'grounding', 'safety', 'latency', 'quality', 'acceptance'],
  product: ['requirements', 'ux', 'documentation', 'localization', 'billing', 'support', 'readiness']
});

const MANDATORY_AGENTS = Object.freeze(
  Object.entries(DOMAINS).flatMap(([domain, roles]) =>
    roles.map((role, index) => Object.freeze({
      id: `${domain}-${role}`,
      domain,
      role,
      ordinal: index + 1,
      mandatory: true
    }))
  )
);

if (MANDATORY_AGENTS.length !== 70) throw new Error('Il catalogo obbligatorio deve contenere esattamente 70 agenti');

class MandatorySeventyAgentRuntime {
  constructor({ handlers = {}, concurrency = 10, telemetry, checkpointStore, failFast = false } = {}) {
    this.handlers = new Map(Object.entries(handlers));
    this.concurrency = Math.max(1, Math.min(70, Number(concurrency) || 10));
    this.telemetry = telemetry;
    this.checkpointStore = checkpointStore;
    this.failFast = Boolean(failFast);
  }

  register(agentId, handler) {
    if (!MANDATORY_AGENTS.some((agent) => agent.id === agentId)) throw new Error(`Agente sconosciuto: ${agentId}`);
    if (typeof handler !== 'function') throw new TypeError(`Handler non valido per ${agentId}`);
    this.handlers.set(agentId, handler);
    return this;
  }

  health() {
    const missing = MANDATORY_AGENTS.filter((agent) => typeof this.handlers.get(agent.id) !== 'function').map((agent) => agent.id);
    return { ready: missing.length === 0, required: 70, registered: 70 - missing.length, missing };
  }

  assertReady() {
    const health = this.health();
    if (!health.ready) {
      const error = new Error(`Runtime incompleto: mancano ${health.missing.length} agenti obbligatori`);
      error.code = 'MANDATORY_70_NOT_READY';
      error.missing = health.missing;
      throw error;
    }
    return health;
  }

  async execute(context = {}) {
    this.assertReady();
    const runId = context.runId || `mandatory-70-${Date.now()}`;
    const results = new Array(MANDATORY_AGENTS.length);
    let cursor = 0;
    let stopped = false;

    await this.emit('mandatory-70.started', { runId, required: 70 });
    const workers = Array.from({ length: this.concurrency }, async () => {
      while (!stopped) {
        const index = cursor++;
        if (index >= MANDATORY_AGENTS.length) return;
        const agent = MANDATORY_AGENTS[index];
        const startedAt = Date.now();
        try {
          const value = await this.handlers.get(agent.id)({ ...context, runId, agent });
          const status = value?.status || 'completed';
          results[index] = { agentId: agent.id, domain: agent.domain, status, output: value?.output ?? value, durationMs: Date.now() - startedAt };
          if (status === 'failed' && this.failFast) stopped = true;
        } catch (error) {
          results[index] = { agentId: agent.id, domain: agent.domain, status: 'failed', error: error.message, code: error.code || 'MANDATORY_AGENT_FAILED', durationMs: Date.now() - startedAt };
          if (this.failFast) stopped = true;
        }
        await this.checkpointStore?.save?.({ runId, index, result: results[index] });
        await this.emit('mandatory-70.agent.completed', { runId, ...results[index] });
      }
    });

    await Promise.all(workers);
    const summary = {
      required: 70,
      completed: results.filter((item) => item?.status === 'completed').length,
      failed: results.filter((item) => item?.status === 'failed').length,
      blocked: results.filter((item) => item?.status === 'blocked').length,
      skipped: results.filter((item) => !item).length
    };
    const complete = summary.completed === 70;
    await this.emit('mandatory-70.completed', { runId, summary, complete });
    return { runId, agents: results, summary, complete };
  }

  async emit(type, payload) {
    await this.telemetry?.record?.({ type, ...payload, at: new Date().toISOString() });
  }
}

module.exports = { DOMAINS, MANDATORY_AGENTS, MandatorySeventyAgentRuntime };
