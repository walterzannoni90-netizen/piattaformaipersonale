'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ToolRegistry } = require('../app/services/toolRegistry');
const { IntelligentToolRouter, scoreTool } = require('../app/services/intelligentToolRouter');

function registry() {
  const tools = new ToolRegistry();
  tools.register({ id: 'fast.search', title: 'Fast', risk: 'read', actions: ['search'], plans: ['pro'], agentRoles: ['operator'], metadata: { capabilities: ['web_search'], reliability: 0.9, latencyMs: 100, cost: 0.05 } });
  tools.register({ id: 'slow.search', title: 'Slow', risk: 'read', actions: ['search'], plans: ['pro'], agentRoles: ['operator'], metadata: { capabilities: ['web_search'], reliability: 0.95, latencyMs: 5000, cost: 0.3 } });
  return tools;
}

test('selects the best capability-compatible tool', async () => {
  const router = new IntelligentToolRouter({ registry: registry() });
  const selected = await router.select({ plan: 'pro', agentRole: 'operator', requiredCapabilities: ['web_search'], maxLatencyMs: 10000, maxCost: 1 });
  assert.equal(selected.toolId, 'fast.search');
  assert.equal(selected.ranking.length, 2);
});

test('uses execution history in ranking', async () => {
  const router = new IntelligentToolRouter({
    registry: registry(),
    historyProvider: async () => [
      { toolId: 'fast.search', success: false },
      { toolId: 'fast.search', success: false },
      { toolId: 'slow.search', success: true },
      { toolId: 'slow.search', success: true }
    ]
  });
  const ranking = await router.rank({ plan: 'pro', agentRole: 'operator', requiredCapabilities: ['web_search'], maxLatencyMs: 100000, maxCost: 10 });
  assert.equal(ranking[0].tool.id, 'slow.search');
});

test('rejects requests with no compatible tool', async () => {
  const router = new IntelligentToolRouter({ registry: registry() });
  await assert.rejects(
    router.select({ plan: 'pro', agentRole: 'operator', requiredCapabilities: ['database_write'] }),
    (error) => error.code === 'NO_SUITABLE_TOOL'
  );
});

test('penalizes higher-risk tools', () => {
  const base = { id: 'tool', actions: ['read'], metadata: { capabilities: ['read'], reliability: 1, latencyMs: 1, cost: 0 } };
  const safe = scoreTool({ ...base, risk: 'read' }, { requiredCapabilities: ['read'] }, []);
  const privileged = scoreTool({ ...base, risk: 'privileged' }, { requiredCapabilities: ['read'] }, []);
  assert.ok(safe.score > privileged.score);
});
