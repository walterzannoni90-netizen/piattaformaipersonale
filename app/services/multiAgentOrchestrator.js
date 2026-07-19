'use strict';

const DEFAULT_ROLES = Object.freeze(['planner', 'executor', 'critic', 'verifier']);

function clean(value, max = 20000) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);
}

function createAgentContext(role, input, shared) {
  return Object.freeze({
    role,
    goal: clean(input.goal, 8000),
    task: input.task || null,
    plan: shared.plan || null,
    execution: shared.execution || null,
    critique: shared.critique || null,
    evidence: [...(shared.evidence || [])],
    metadata: { ...(input.metadata || {}) }
  });
}

class MultiAgentOrchestrator {
  constructor({ agents = {}, router, runtime, memory, maxRounds = 3 } = {}) {
    this.agents = new Map(Object.entries(agents));
    this.router = router;
    this.runtime = runtime;
    this.memory = memory;
    this.maxRounds = Math.max(1, Number(maxRounds) || 3);
  }

  registerAgent(role, handler) {
    if (!DEFAULT_ROLES.includes(role)) throw new Error(`Ruolo non supportato: ${role}`);
    if (typeof handler !== 'function') throw new Error('Handler agente non valido');
    this.agents.set(role, handler);
  }

  async invoke(role, context) {
    const agent = this.agents.get(role);
    if (!agent) throw Object.assign(new Error(`Agente mancante: ${role}`), { code: 'AGENT_MISSING' });
    const result = await agent(context);
    if (!result || typeof result !== 'object') throw Object.assign(new Error(`Risultato agente non valido: ${role}`), { code: 'AGENT_RESULT_INVALID' });
    return result;
  }

  async executeTools(tasks, input, shared) {
    const results = [];
    for (const task of Array.isArray(tasks) ? tasks : []) {
      const selection = await this.router.select({
        plan: input.plan,
        agentRole: 'operator',
        requiredCapabilities: task.requiredCapabilities,
        maxLatencyMs: task.maxLatencyMs,
        maxCost: task.maxCost,
        allowedToolIds: task.allowedToolIds
      });
      const execution = await this.runtime.execute({
        toolId: selection.toolId,
        action: task.action,
        plan: input.plan,
        agentRole: 'operator',
        payload: task.payload,
        approvedPayloadHash: task.approvedPayloadHash,
        timeoutMs: task.timeoutMs
      });
      results.push({ taskId: task.id || null, selection, execution });
      shared.evidence.push({ type: 'tool_result', toolId: selection.toolId, resultHash: execution.resultHash });
    }
    return results;
  }

  async run(input = {}) {
    if (!clean(input.goal)) throw new Error('Obiettivo obbligatorio');
    const runId = input.runId || `multi-${Date.now().toString(36)}`;
    const shared = { evidence: [], plan: null, execution: null, critique: null };
    const history = [];
    await this.memory?.appendEvent?.(runId, { type: 'multi_agent_started', goal: clean(input.goal, 1000) });

    shared.plan = await this.invoke('planner', createAgentContext('planner', input, shared));
    history.push({ role: 'planner', status: 'completed' });

    for (let round = 1; round <= this.maxRounds; round += 1) {
      const executorOutput = await this.invoke('executor', createAgentContext('executor', input, shared));
      const toolExecutions = await this.executeTools(executorOutput.toolTasks, input, shared);
      shared.execution = { ...executorOutput, toolExecutions };
      history.push({ role: 'executor', round, status: 'completed', tools: toolExecutions.length });

      shared.critique = await this.invoke('critic', createAgentContext('critic', input, shared));
      history.push({ role: 'critic', round, status: 'completed', approved: shared.critique.approved === true });

      const verification = await this.invoke('verifier', createAgentContext('verifier', input, shared));
      history.push({ role: 'verifier', round, status: 'completed', passed: verification.passed === true });

      if (shared.critique.approved === true && verification.passed === true) {
        const result = { runId, status: 'completed', rounds: round, plan: shared.plan, execution: shared.execution, critique: shared.critique, verification, history };
        await this.memory?.appendEvent?.(runId, { type: 'multi_agent_completed', rounds: round });
        return result;
      }

      if (round < this.maxRounds) {
        shared.plan = await this.invoke('planner', createAgentContext('planner', { ...input, task: { replan: true, feedback: { critique: shared.critique, verification } } }, shared));
        history.push({ role: 'planner', round, status: 'replanned' });
      }
    }

    const error = Object.assign(new Error('Verifica multi-agente non superata'), { code: 'MULTI_AGENT_VERIFICATION_FAILED', history });
    await this.memory?.appendEvent?.(runId, { type: 'multi_agent_failed', code: error.code });
    throw error;
  }
}

module.exports = { MultiAgentOrchestrator, DEFAULT_ROLES, createAgentContext };
