const test = require('node:test');
const assert = require('node:assert/strict');
const { teamSizeForPlan, buildRoster, runAgentTeam } = require('../app/services/agentTeam');

const task = {
  id: 'team-task',
  user_id: 'team-owner',
  prompt: 'Analizza il mercato italiano, confronta le alternative e crea un piano verificabile.'
};

test('Agent Team dimensions the roster by plan and hard safety cap', () => {
  assert.equal(teamSizeForPlan('starter'), 2);
  assert.equal(teamSizeForPlan('pro'), 4);
  assert.equal(teamSizeForPlan('enterprise'), 6);
  assert.equal(teamSizeForPlan('enterprise', 3), 3);
  assert.deepEqual(buildRoster('starter').map((agent) => agent.id), ['scout', 'analyst']);
});

test('Agent Team runs independent specialists in bounded parallel and deduplicates sources', async () => {
  let active = 0;
  let maximumActive = 0;
  let searches = 0;
  const prompts = [];
  const lifecycle = [];
  const result = await runAgentTeam({
    task,
    context: { user: { plan: 'pro', company_name: 'WES Test', sector: 'Servizi' }, memories: [] },
    concurrency: 2,
    search: async (query) => {
      searches += 1;
      return [{ title: 'Fonte ufficiale', url: 'https://example.com/report', content: `Dati per ${query}`, score: 0.9 }];
    },
    complete: async (messages) => {
      active += 1;
      maximumActive = Math.max(maximumActive, active);
      prompts.push(messages);
      await new Promise((resolve) => setTimeout(resolve, 15));
      active -= 1;
      return { success: true, content: '## Rapporto indipendente\n\nEvidenza verificata e analisi operativa. '.repeat(4), usage: { total_tokens: 240 } };
    },
    onAgentStart: (agent) => lifecycle.push(`start:${agent.id}`),
    onAgentComplete: (agent) => lifecycle.push(`done:${agent.id}`)
  });

  assert.equal(result.summary.requested, 4);
  assert.equal(result.summary.completed, 4);
  assert.equal(searches, 2);
  assert.equal(result.sources.length, 1);
  assert.ok(maximumActive >= 2);
  assert.ok(maximumActive <= 2);
  assert.equal(lifecycle.filter((entry) => entry.startsWith('start:')).length, 4);
  assert.equal(lifecycle.filter((entry) => entry.startsWith('done:')).length, 4);
  assert.ok(prompts.every((messages) => /contenuti non attendibili/.test(messages[0].content)));
});

test('Agent Team degrades transparently while preserving a two-agent quorum', async () => {
  const failed = [];
  const result = await runAgentTeam({
    task,
    context: { user: { plan: 'pro' } },
    search: async () => [],
    complete: async (messages) => {
      const system = messages[0].content;
      if (/Analyst|Red Team/.test(system)) return { success: false, code: 'AI_REQUEST_FAILED', error: 'modello non disponibile' };
      return { success: true, content: 'Rapporto autonomo completo con ipotesi, evidenze, rischi e azioni. '.repeat(3), usage: {} };
    },
    onAgentFailure: (agent) => failed.push(agent.id)
  });
  assert.equal(result.summary.completed, 2);
  assert.equal(result.summary.failed, 2);
  assert.deepEqual(failed, ['analyst', 'red-team']);
});

test('Agent Team refuses delivery without quorum and honors cancellation', async () => {
  await assert.rejects(runAgentTeam({
    task,
    context: { user: { plan: 'starter' } },
    search: async () => [],
    complete: async () => ({ success: false, code: 'AI_NOT_CONFIGURED', error: 'chiave assente' })
  }), (error) => error.code === 'AI_NOT_CONFIGURED' && /chiave assente/.test(error.message));

  let called = false;
  await assert.rejects(runAgentTeam({
    task,
    context: { user: { plan: 'starter' } },
    isCancelled: () => true,
    complete: async () => { called = true; return { success: true, content: 'x'.repeat(100) }; }
  }), (error) => error.code === 'TASK_CANCELLED');
  assert.equal(called, false);
});
