'use strict';

const { AdvancedTenAgentProgram } = require('./advancedTenAgentProgram');
const { createAdvancedCapabilityAdapters } = require('./advancedCapabilityAdapters');

function createAdvancedAutonomyFactory(deps = {}) {
  const handlers = createAdvancedCapabilityAdapters(deps);
  const program = new AdvancedTenAgentProgram({
    handlers,
    telemetry: deps.telemetry,
    memory: deps.memory,
    concurrency: 10,
    failFast: false
  });

  return {
    program,
    handlers,
    run: (context) => program.run(context),
    health: () => ({
      ready: Object.keys(handlers).length === 10,
      agents: 10,
      registered: Object.keys(handlers).length
    })
  };
}

module.exports = { createAdvancedAutonomyFactory };