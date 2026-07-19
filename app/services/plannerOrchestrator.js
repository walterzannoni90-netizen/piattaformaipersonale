'use strict';

const {
  createPlan,
  executePlan,
  approvalHash
} = require('./autonomousPlanner');
const { ToolRegistry } = require('./toolRegistry');

const EXTERNAL_TOOLS = new Set(['send_email', 'send_whatsapp', 'create_appointment', 'update_lead_status']);
const DEFAULT_ROLES = ['orchestrator', 'analyst', 'scout', 'operator', 'auditor'];
const DEFAULT_PLANS = ['starter', 'pro', 'enterprise'];

function clean(value, max = 500) {
  return String(value || '').replace(/[\u0000-\u001F]/g, '').trim().slice(0, max);
}

function createOrchestratorRegistry(toolNames = []) {
  const registry = new ToolRegistry();
  for (const name of [...new Set(toolNames.map((value) => clean(value, 64)).filter(Boolean))]) {
    const external = EXTERNAL_TOOLS.has(name);
    registry.register({
      id: `orchestrator.${name.replace(/_/g, '.')}`,
      title: name,
      risk: external ? 'external_side_effect' : 'read',
      actions: ['execute'],
      plans: DEFAULT_PLANS,
      agentRoles: DEFAULT_ROLES,
      requiresApproval: external
    });
  }
  return registry;
}

function normalizeLegacyPlan({ task, legacyPlan }) {
  if (!task || !task.id || !task.prompt) throw new Error('Task non valido');
  if (!legacyPlan || !Array.isArray(legacyPlan.steps) || legacyPlan.steps.length === 0) throw new Error('Piano legacy non valido');
  let previous = null;
  const steps = legacyPlan.steps.map((step, index) => {
    const id = clean(step.id || `step-${index + 1}`, 64);
    const normalized = {
      id,
      title: clean(step.title || `Passaggio ${index + 1}`, 140),
      tool: clean(step.tool || 'reasoning', 64),
      input: step.input && typeof step.input === 'object' && !Array.isArray(step.input) ? step.input : {},
      dependsOn: Array.isArray(step.dependsOn) ? step.dependsOn : (previous ? [previous] : []),
      maxAttempts: Number(step.maxAttempts || (EXTERNAL_TOOLS.has(step.tool) ? 1 : 2)),
      approvalRequired: EXTERNAL_TOOLS.has(step.tool) || step.approvalRequired === true
    };
    previous = id;
    return normalized;
  });
  return createPlan({
    goal: task.prompt,
    taskId: task.id,
    steps,
    metadata: {
      userId: task.user_id || null,
      projectId: task.project_id || null,
      mode: task.mode || 'autonomous',
      legacyTitle: clean(legacyPlan.title, 140)
    }
  });
}

function snapshot(plan) {
  return JSON.parse(JSON.stringify(plan));
}

async function runOrchestratedPlan({
  task,
  legacyPlan,
  handlers,
  accountPlan = 'starter',
  agentRole = 'orchestrator',
  approve,
  onStateChange,
  signal,
  registry
}) {
  if (!handlers || typeof handlers !== 'object') throw new Error('Handler strumenti obbligatori');
  const plan = normalizeLegacyPlan({ task, legacyPlan });
  const activeRegistry = registry || createOrchestratorRegistry(plan.steps.map((step) => step.tool));

  const notify = async (event, step = null) => {
    if (typeof onStateChange === 'function') await onStateChange({ event, step, plan: snapshot(plan) });
  };

  await notify('plan_created');
  const completed = await executePlan(plan, async ({ step, attempt }) => {
    const handler = handlers[step.tool];
    if (typeof handler !== 'function') {
      const error = new Error(`Handler non disponibile: ${step.tool}`);
      error.code = 'handler_not_available';
      throw error;
    }
    const toolId = `orchestrator.${step.tool.replace(/_/g, '.')}`;
    const approvedPayloadHash = plan.state[step.id].approvalHash;
    const authorization = activeRegistry.authorize({
      toolId,
      action: 'execute',
      plan: accountPlan,
      agentRole,
      approvedPayloadHash
    });
    if (!authorization.allowed) {
      const error = new Error(`Strumento non autorizzato: ${authorization.reason}`);
      error.code = authorization.reason;
      throw error;
    }
    await notify('step_started', step);
    const result = await handler({ task, step, attempt, plan: snapshot(plan), signal });
    await notify('step_completed', step);
    return result;
  }, {
    signal,
    approve: async ({ step }) => {
      const expected = approvalHash(plan, step);
      if (typeof approve !== 'function') return null;
      return approve({ task, step, approvalHash: expected, plan: snapshot(plan) });
    },
    onRetry: async ({ step, error, attempt }) => {
      await notify('step_retry', { ...step, error: clean(error?.message || error, 1000), attempt });
    }
  });
  await notify(`plan_${completed.status}`);
  return completed;
}

module.exports = {
  EXTERNAL_TOOLS,
  createOrchestratorRegistry,
  normalizeLegacyPlan,
  runOrchestratedPlan,
  snapshot
};
