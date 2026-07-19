'use strict';

const crypto = require('crypto');
const { buildExecutionGraph, executeGraph } = require('./autonomousExecutionKernel');

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function tokenize(value) {
  return [...new Set(String(value || '').toLowerCase().match(/[a-zà-ÿ0-9_]{3,}/g) || [])];
}

class SemanticMemory {
  constructor({ store } = {}) {
    this.store = store || new Map();
  }

  async remember({ scope = 'global', text, metadata = {} }) {
    const item = { id: hash({ scope, text, metadata }).slice(0, 20), scope, text: String(text), tokens: tokenize(text), metadata, createdAt: Date.now() };
    this.store.set(item.id, item);
    return item;
  }

  async recall(query, { scope, limit = 5 } = {}) {
    const queryTokens = tokenize(query);
    return [...this.store.values()]
      .filter((item) => !scope || item.scope === scope)
      .map((item) => ({ ...item, score: queryTokens.reduce((sum, token) => sum + (item.tokens.includes(token) ? 1 : 0), 0) / Math.max(1, queryTokens.length) }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score || b.createdAt - a.createdAt)
      .slice(0, Math.max(1, limit));
  }
}

class ToolSelector {
  constructor(tools = []) {
    this.tools = tools.map((tool) => ({ cost: 1, reliability: 0.8, capabilities: [], ...tool }));
  }

  select(step, context = {}) {
    const required = new Set([...(step.capabilities || []), step.action].filter(Boolean));
    const candidates = this.tools.map((tool) => {
      const coverage = [...required].filter((capability) => tool.capabilities.includes(capability) || tool.name === capability).length;
      const score = coverage * 4 + tool.reliability * 3 - tool.cost - Number(context.failures?.[tool.name] || 0) * 2;
      return { tool, score, coverage };
    }).filter((candidate) => candidate.coverage > 0);
    candidates.sort((a, b) => b.score - a.score);
    return candidates[0]?.tool || null;
  }
}

function createHierarchicalPlan(goal, outline = []) {
  const steps = [];
  for (const [phaseIndex, phase] of outline.entries()) {
    const phaseId = phase.id || `phase-${phaseIndex + 1}`;
    const children = phase.steps?.length ? phase.steps : [{ action: phase.action || 'reason', title: phase.title }];
    children.forEach((child, childIndex) => {
      steps.push({
        ...child,
        id: child.id || `${phaseId}.${childIndex + 1}`,
        dependencies: child.dependencies || (phaseIndex ? [outline[phaseIndex - 1].terminalId || `phase-${phaseIndex}.${(outline[phaseIndex - 1].steps || [1]).length}`] : []),
        agentRole: child.agentRole || phase.agentRole || 'generalist',
        capabilities: child.capabilities || phase.capabilities || []
      });
    });
    phase.terminalId = steps[steps.length - 1].id;
  }
  return buildExecutionGraph(goal, steps);
}

class AgentPool {
  constructor(agents = []) {
    this.agents = agents.map((agent) => ({ load: 0, reliability: 0.8, roles: ['generalist'], ...agent }));
  }

  acquire(role = 'generalist') {
    const matches = this.agents.filter((agent) => agent.roles.includes(role) || agent.roles.includes('generalist'));
    matches.sort((a, b) => (a.load - b.load) || (b.reliability - a.reliability));
    const agent = matches[0];
    if (!agent) return null;
    agent.load += 1;
    return agent;
  }

  release(agent, success = true) {
    if (!agent) return;
    agent.load = Math.max(0, agent.load - 1);
    agent.reliability = Math.max(0.1, Math.min(1, agent.reliability + (success ? 0.01 : -0.05)));
  }
}

class BrowserRecoveryController {
  constructor({ maxRecoveries = 3 } = {}) {
    this.maxRecoveries = maxRecoveries;
  }

  async run(action, { browser, checkpoint, onRecovery } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= this.maxRecoveries + 1; attempt += 1) {
      try {
        return await action({ browser, attempt });
      } catch (error) {
        lastError = error;
        if (attempt > this.maxRecoveries || ['AUTH_REQUIRED', 'CAPTCHA_REQUIRED'].includes(error.code)) throw error;
        await checkpoint?.({ type: 'browser_recovery', attempt, code: error.code || 'BROWSER_ERROR' });
        if (typeof browser?.recover === 'function') await browser.recover({ attempt, error });
        await onRecovery?.({ attempt, error });
      }
    }
    throw lastError;
  }
}

function evaluateQuality(result, rubric = {}) {
  const text = typeof result === 'string' ? result : JSON.stringify(result || {});
  const checks = {
    nonEmpty: text.trim().length > 0,
    minLength: text.length >= Number(rubric.minLength || 1),
    requiredTerms: (rubric.requiredTerms || []).every((term) => text.toLowerCase().includes(String(term).toLowerCase())),
    noPlaceholders: !/(todo|tbd|placeholder|lorem ipsum)/i.test(text)
  };
  const score = Object.values(checks).filter(Boolean).length / Object.keys(checks).length;
  return { score, passed: score >= Number(rubric.threshold || 0.75), checks };
}

class DistributedTaskQueue {
  constructor({ leaseMs = 30_000 } = {}) {
    this.leaseMs = leaseMs;
    this.jobs = new Map();
  }

  enqueue(payload, { priority = 0 } = {}) {
    const id = hash({ payload, now: Date.now(), random: Math.random() }).slice(0, 20);
    this.jobs.set(id, { id, payload, priority, status: 'queued', attempts: 0, leasedUntil: 0 });
    return id;
  }

  claim(workerId) {
    const now = Date.now();
    const jobs = [...this.jobs.values()].filter((job) => job.status === 'queued' || (job.status === 'leased' && job.leasedUntil <= now));
    jobs.sort((a, b) => b.priority - a.priority || a.attempts - b.attempts);
    const job = jobs[0];
    if (!job) return null;
    Object.assign(job, { status: 'leased', workerId, leasedUntil: now + this.leaseMs, attempts: job.attempts + 1 });
    return { ...job };
  }

  complete(id, result) {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Job sconosciuto');
    Object.assign(job, { status: 'completed', result, leasedUntil: 0 });
  }

  fail(id, error, { retry = true } = {}) {
    const job = this.jobs.get(id);
    if (!job) throw new Error('Job sconosciuto');
    Object.assign(job, { status: retry ? 'queued' : 'failed', error: { code: error?.code || 'ERROR', message: error?.message || String(error) }, leasedUntil: 0 });
  }
}

async function runMultiAgentTask({ goal, outline, agents, tools, handlers = {}, memory = new SemanticMemory(), browser, checkpoint, onEvent, concurrency = 4, qualityRubric } = {}) {
  const graph = createHierarchicalPlan(goal, outline);
  const pool = new AgentPool(agents);
  const selector = new ToolSelector(tools);
  const browserRecovery = new BrowserRecoveryController();
  const failures = {};

  const result = await executeGraph({
    graph,
    concurrency,
    checkpoint,
    onEvent,
    handlers: {
      default: async ({ node, graph: activeGraph, signal }) => {
        const agent = pool.acquire(node.agentRole);
        if (!agent) throw Object.assign(new Error(`Nessun agente per ${node.agentRole}`), { code: 'AGENT_UNAVAILABLE' });
        const tool = selector.select(node, { failures });
        if (!tool) {
          pool.release(agent, false);
          throw Object.assign(new Error(`Nessuno strumento per ${node.action}`), { code: 'TOOL_UNAVAILABLE' });
        }
        const recalled = await memory.recall(`${goal} ${node.title}`, { scope: goal, limit: 3 });
        try {
          const executor = handlers[tool.name] || handlers[node.action];
          if (typeof executor !== 'function') throw Object.assign(new Error(`Executor mancante: ${tool.name}`), { code: 'HANDLER_MISSING' });
          const invoke = () => executor({ node, graph: activeGraph, agent, tool, memory: recalled, browser, signal });
          const output = tool.capabilities.includes('browser') ? await browserRecovery.run(invoke, { browser, checkpoint }) : await invoke();
          const quality = evaluateQuality(output, qualityRubric?.[node.action] || {});
          if (!quality.passed) throw Object.assign(new Error('Qualità insufficiente'), { code: 'QUALITY_GATE_FAILED', quality });
          await memory.remember({ scope: goal, text: typeof output === 'string' ? output : JSON.stringify(output), metadata: { nodeId: node.id, tool: tool.name, agent: agent.id } });
          pool.release(agent, true);
          return { output, quality, agentId: agent.id, tool: tool.name };
        } catch (error) {
          failures[tool.name] = Number(failures[tool.name] || 0) + 1;
          pool.release(agent, false);
          throw error;
        }
      }
    }
  });

  return { ...result, memory, agentMetrics: pool.agents, toolFailures: failures };
}

async function runAgentBenchmark(cases, runner) {
  const startedAt = Date.now();
  const results = [];
  for (const testCase of cases) {
    const start = Date.now();
    try {
      const output = await runner(testCase);
      const quality = evaluateQuality(output, testCase.rubric || {});
      results.push({ id: testCase.id, passed: quality.passed, score: quality.score, durationMs: Date.now() - start });
    } catch (error) {
      results.push({ id: testCase.id, passed: false, score: 0, durationMs: Date.now() - start, error: error.code || error.message });
    }
  }
  const passed = results.filter((item) => item.passed).length;
  return { total: results.length, passed, passRate: results.length ? passed / results.length : 1, durationMs: Date.now() - startedAt, results };
}

module.exports = {
  SemanticMemory,
  ToolSelector,
  createHierarchicalPlan,
  AgentPool,
  BrowserRecoveryController,
  evaluateQuality,
  DistributedTaskQueue,
  runMultiAgentTask,
  runAgentBenchmark
};
