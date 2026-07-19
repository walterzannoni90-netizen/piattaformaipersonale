'use strict';

const VALID_RISK = new Set(['read', 'write', 'external_side_effect', 'privileged']);

class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(definition) {
    const normalized = normalizeDefinition(definition);
    if (this.tools.has(normalized.id)) throw new Error(`Strumento già registrato: ${normalized.id}`);
    this.tools.set(normalized.id, Object.freeze(normalized));
    return normalized;
  }

  get(id) {
    return this.tools.get(String(id || '').trim()) || null;
  }

  list({ plan, agentRole } = {}) {
    return [...this.tools.values()].filter((tool) => {
      if (plan && !tool.plans.includes(plan)) return false;
      if (agentRole && !tool.agentRoles.includes(agentRole)) return false;
      return true;
    });
  }

  authorize({ toolId, action, plan, agentRole, approvedPayloadHash = null }) {
    const tool = this.get(toolId);
    if (!tool) return denied('tool_not_registered');
    if (!tool.enabled) return denied('tool_disabled');
    if (!tool.actions.includes(action)) return denied('action_not_allowed');
    if (!tool.plans.includes(plan)) return denied('plan_not_allowed');
    if (!tool.agentRoles.includes(agentRole)) return denied('agent_not_allowed');
    const actionRequiresApproval = tool.requiresApproval || tool.approvalActions.includes(action);
    if (actionRequiresApproval && !approvedPayloadHash) return denied('approval_required');
    return { allowed: true, reason: null, tool };
  }
}

function normalizeDefinition(definition = {}) {
  const id = String(definition.id || '').trim();
  if (!/^[a-z][a-z0-9_.-]{2,63}$/.test(id)) throw new Error('ID strumento non valido');
  const risk = definition.risk || 'read';
  if (!VALID_RISK.has(risk)) throw new Error('Livello di rischio non valido');
  const actions = uniqueStrings(definition.actions);
  const plans = uniqueStrings(definition.plans);
  const agentRoles = uniqueStrings(definition.agentRoles);
  const approvalActions = uniqueStrings(definition.approvalActions);
  if (!actions.length || !plans.length || !agentRoles.length) throw new Error('Azioni, piani e ruoli sono obbligatori');
  if (approvalActions.some((action) => !actions.includes(action))) throw new Error('Azione di approvazione non registrata');
  const hasPerActionPolicy = Object.prototype.hasOwnProperty.call(definition, 'approvalActions');
  return {
    id,
    title: String(definition.title || id).trim().slice(0, 120),
    risk,
    actions,
    plans,
    agentRoles,
    enabled: definition.enabled !== false,
    requiresApproval: definition.requiresApproval === true || (!hasPerActionPolicy && ['external_side_effect', 'privileged'].includes(risk)),
    approvalActions,
    metadata: Object.freeze({ ...(definition.metadata || {}) })
  };
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value).trim()).filter(Boolean))];
}

function denied(reason) {
  return { allowed: false, reason, tool: null };
}

function createDefaultRegistry() {
  const registry = new ToolRegistry();
  registry.register({
    id: 'python.analysis', title: 'Python protetto', risk: 'write',
    actions: ['analyze_file', 'create_report', 'transform_data'],
    plans: ['starter', 'pro', 'enterprise'],
    agentRoles: ['orchestrator', 'analyst', 'auditor']
  });
  registry.register({
    id: 'browser.session', title: 'Browser Agent', risk: 'external_side_effect',
    actions: ['navigate', 'screenshot', 'extract', 'download', 'upload', 'submit'],
    approvalActions: ['download', 'upload', 'submit'],
    plans: ['pro', 'enterprise'],
    agentRoles: ['orchestrator', 'scout', 'operator']
  });
  return registry;
}

module.exports = { ToolRegistry, createDefaultRegistry };
