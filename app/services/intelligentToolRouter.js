'use strict';

function clamp(value, min = 0, max = 1) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

function normalizeCapabilities(values) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => String(value).trim().toLowerCase()).filter(Boolean))];
}

function scoreTool(tool, request = {}, history = []) {
  const required = normalizeCapabilities(request.requiredCapabilities);
  const offered = normalizeCapabilities(tool.metadata?.capabilities || tool.actions || []);
  const matched = required.filter((capability) => offered.includes(capability));
  const coverage = required.length ? matched.length / required.length : 1;
  const reliability = clamp(tool.metadata?.reliability ?? 0.8);
  const latencyScore = 1 - clamp((tool.metadata?.latencyMs ?? 1000) / Math.max(1, request.maxLatencyMs || 10000));
  const costScore = 1 - clamp((tool.metadata?.cost ?? 0) / Math.max(0.0001, request.maxCost || 1));
  const historical = history.filter((item) => item.toolId === tool.id);
  const historicalSuccess = historical.length
    ? historical.filter((item) => item.success === true).length / historical.length
    : 0.75;
  const riskPenalty = ({ read: 0, write: 0.08, external_side_effect: 0.2, privileged: 0.35 })[tool.risk] || 0;
  const weights = { coverage: 0.4, reliability: 0.2, latency: 0.12, cost: 0.12, history: 0.16 };
  const score = (
    coverage * weights.coverage +
    reliability * weights.reliability +
    latencyScore * weights.latency +
    costScore * weights.cost +
    historicalSuccess * weights.history -
    riskPenalty
  );
  return { toolId: tool.id, score, coverage, reliability, latencyScore, costScore, historicalSuccess, matched };
}

class IntelligentToolRouter {
  constructor({ registry, historyProvider = () => [] } = {}) {
    if (!registry) throw new Error('Tool registry obbligatorio');
    this.registry = registry;
    this.historyProvider = historyProvider;
  }

  async rank(request = {}) {
    const tools = this.registry.list({ plan: request.plan, agentRole: request.agentRole });
    const history = await this.historyProvider(request);
    return tools
      .filter((tool) => !request.allowedToolIds || request.allowedToolIds.includes(tool.id))
      .map((tool) => ({ tool, ...scoreTool(tool, request, history) }))
      .filter((candidate) => candidate.coverage >= (request.minimumCoverage ?? 1))
      .sort((a, b) => b.score - a.score || a.tool.id.localeCompare(b.tool.id));
  }

  async select(request = {}) {
    const ranked = await this.rank(request);
    if (!ranked.length) {
      const error = new Error('Nessuno strumento soddisfa capacità e policy richieste');
      error.code = 'NO_SUITABLE_TOOL';
      throw error;
    }
    const winner = ranked[0];
    return { toolId: winner.tool.id, tool: winner.tool, score: winner.score, ranking: ranked.map(({ tool, ...rest }) => ({ ...rest, toolId: tool.id })) };
  }
}

module.exports = { IntelligentToolRouter, scoreTool, normalizeCapabilities };
