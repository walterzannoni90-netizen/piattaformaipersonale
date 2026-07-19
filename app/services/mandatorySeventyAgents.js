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

const MANDATORY_AGENTS = Object.freeze(Object.entries(DOMAINS).flatMap(([domain, roles]) =>
  roles.map((role, index) => Object.freeze({ id: `${domain}-${role}`, domain, role, ordinal: index + 1, mandatory: true }))
));
if (MANDATORY_AGENTS.length !== 70) throw new Error('Il catalogo obbligatorio deve contenere esattamente 70 agenti');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

class MandatorySeventyAgentRuntime {
  constructor({ handlers = {}, concurrency = 10, telemetry, checkpointStore, failFast = false, timeoutMs = 30000, retries = 1, retryDelayMs = 25 } = {}) {
    this.handlers = new Map(Object.entries(handlers));
    this.concurrency = Math.max(1, Math.min(70, Number(concurrency) || 10));
    this.telemetry = telemetry;
    this.checkpointStore = checkpointStore;
    this.failFast = Boolean(failFast);
    this.timeoutMs = Math.max(1, Number(timeoutMs) || 30000);
    this.retries = Math.max(0, Math.min(10, Number(retries) || 0));
    this.retryDelayMs = Math.max(0, Number(retryDelayMs) || 0);
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

  async invoke(agent, context) {
    let lastError;
    for (let attempt = 0; attempt <= this.retries; attempt += 1) {
      const startedAt = Date.now();
      try {
        const timeout = new Promise((_, reject) => setTimeout(() => {
          const error = new Error(`Timeout agente ${agent.id}`);
          error.code = 'MANDATORY_AGENT_TIMEOUT';
          reject(error);
        }, this.timeoutMs));
        const value = await Promise.race([this.handlers.get(agent.id)({ ...context, agent, attempt }), timeout]);
        return { agentId: agent.id, domain: agent.domain, status: value?.status || 'completed', output: value?.output ?? value, attempt, durationMs: Date.now() - startedAt };
      } catch (error) {
        lastError = error;
        await this.emit('mandatory-70.agent.retry', { runId: context.runId, agentId: agent.id, attempt, error: error.message, code: error.code });
        if (attempt < this.retries) await sleep(this.retryDelayMs * (attempt + 1));
      }
    }
    return { agentId: agent.id, domain: agent.domain, status: 'failed', error: lastError.message, code: lastError.code || 'MANDATORY_AGENT_FAILED', attempts: this.retries + 1 };
  }

  async execute(context = {}) {
    this.assertReady();
    const runId = context.runId || `mandatory-70-${Date.now()}`;
    const resumed = await this.checkpointStore?.load?.(runId);
    const results = new Array(70);
    for (const item of resumed?.results || []) if (item?.agentId) results[MANDATORY_AGENTS.findIndex((a) => a.id === item.agentId)] = item;
    let cursor = 0;
    let stopped = false;
    await this.emit('mandatory-70.started', { runId, required: 70, resumed: results.filter(Boolean).length });

    const workers = Array.from({ length: this.concurrency }, async () => {
      while (!stopped) {
        const index = cursor++;
        if (index >= 70) return;
        if (results[index]?.status === 'completed') continue;
        const result = await this.invoke(MANDATORY_AGENTS[index], { ...context, runId });
        results[index] = result;
        if (result.status === 'failed' && this.failFast) stopped = true;
        await this.checkpointStore?.save?.({ runId, index, result, results: results.filter(Boolean) });
        await this.emit('mandatory-70.agent.completed', { runId, ...result });
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
