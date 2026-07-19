'use strict';

const { ProductionAutonomyRuntime } = require('./productionAutonomyRuntime');
const { SemanticMemoryIndex, ProcessSandbox, SecurePluginRegistry, RuntimeOptimizer, ObservabilityStore, createAutomaticReplanner, createSelfImprover } = require('./productionCapabilitySuite');

function createProductionAutonomyRuntime(deps = {}) {
  const telemetry = deps.telemetry || new ObservabilityStore();
  const optimizer = deps.optimizer || new RuntimeOptimizer();
  const semanticMemory = deps.semanticMemory || new SemanticMemoryIndex(deps.vectorStore, deps.embed);
  const sandbox = deps.sandbox || new ProcessSandbox({ commandAllowlist: deps.commandAllowlist || ['node', 'npm'] });
  const pluginRegistry = deps.pluginRegistry || new SecurePluginRegistry({ trustedKeys: deps.trustedPluginKeys || {}, permissions: deps.pluginPermissions || [] });
  const replanner = deps.replanner || createAutomaticReplanner({ planner: deps.planner, verifier: deps.planVerifier, maxRounds: deps.maxReplanRounds || 3 });
  const selfImprover = deps.selfImprover || createSelfImprover({ memory: deps.memory, promptStore: deps.promptStore });

  const runtime = new ProductionAutonomyRuntime({
    ...deps,
    telemetry,
    optimizer,
    semanticMemory,
    sandbox,
    pluginRegistry,
    replanner,
    selfImprover,
    browser: deps.browserRuntime,
    terminal: deps.terminalRuntime || { execute: ({ command, args, ...options }) => sandbox.run(command, args, options) },
    codeEditor: deps.codeRuntime,
    testRunner: deps.testRuntime,
    benchmarkRunner: deps.benchmarkRunner
  });

  return { runtime, telemetry, optimizer, semanticMemory, sandbox, pluginRegistry, replanner, selfImprover };
}

module.exports = { createProductionAutonomyRuntime };
