'use strict';

const { MANDATORY_AGENTS, MandatorySeventyAgentRuntime } = require('./mandatorySeventyAgents');

function createMandatorySeventyHandlers(capabilities = {}) {
  return Object.fromEntries(MANDATORY_AGENTS.map((agent) => [agent.id, async (context) => {
    const domainCapability = capabilities[agent.domain];
    const roleHandler = domainCapability?.[agent.role];
    const genericHandler = domainCapability?.execute;
    const handler = typeof roleHandler === 'function' ? roleHandler : genericHandler;
    if (typeof handler !== 'function') {
      const error = new Error(`Capacità reale non configurata: ${agent.id}`);
      error.code = 'MANDATORY_CAPABILITY_MISSING';
      throw error;
    }
    return handler({ ...context, role: agent.role, domain: agent.domain });
  }]));
}

function createMandatorySeventyRuntime(deps = {}) {
  const handlers = deps.handlers || createMandatorySeventyHandlers(deps.capabilities || {});
  const runtime = new MandatorySeventyAgentRuntime({
    handlers,
    concurrency: deps.concurrency || 10,
    telemetry: deps.telemetry,
    checkpointStore: deps.checkpointStore,
    failFast: deps.failFast
  });
  return { runtime, handlers, health: () => runtime.health(), execute: (context) => runtime.execute(context) };
}

module.exports = { createMandatorySeventyHandlers, createMandatorySeventyRuntime };
