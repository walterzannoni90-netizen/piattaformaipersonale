'use strict';

const { OperationalTenRuntime } = require('./operationalTenRuntime');
const { createOperationalCapabilityAdapters } = require('./operationalCapabilityAdapters');

function createOperationalAutonomyFactory(deps = {}) {
  const handlers = createOperationalCapabilityAdapters(deps);
  const runtime = new OperationalTenRuntime({
    handlers,
    telemetry: deps.telemetry,
    checkpointStore: deps.checkpointStore,
    concurrency: deps.concurrency || 10
  });

  return {
    runtime,
    handlers,
    execute: (context) => runtime.execute(context),
    health: () => runtime.health()
  };
}

module.exports = { createOperationalAutonomyFactory };
