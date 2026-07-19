'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeLegacyPlan,
  runOrchestratedPlan
} = require('../app/services/plannerOrchestrator');

const task = { id: 'task-1', user_id: 'user-1', prompt: 'Analizza e prepara il risultato', mode: 'autonomous' };

function legacyPlan(steps) {
  return { title: 'Piano', steps };
}

test('normalizes legacy steps into deterministic dependencies', () => {
  const plan = normalizeLegacyPlan({
    task,
    legacyPlan: legacyPlan([
      { id: 'research', tool: 'web_search', input: { query: 'test' } },
      { id: 'compose', tool: 'compose' }
    ])
  });
  assert.deepEqual(plan.steps[0].dependsOn, []);
  assert.deepEqual(plan.steps[1].dependsOn, ['research']);
  assert.equal(plan.id, task.id);
});

test('executes handlers in order and emits state snapshots', async () => {
  const calls = [];
  const events = [];
  const plan = await runOrchestratedPlan({
    task,
    accountPlan: 'starter',
    legacyPlan: legacyPlan([
      { id: 'understand', tool: 'reasoning' },
      { id: 'compose', tool: 'compose' }
    ]),
    handlers: {
      reasoning: async () => { calls.push('reasoning'); return { context: true }; },
      compose: async ({ plan: current }) => { calls.push('compose'); assert.equal(current.state.understand.status, 'completed'); return 'done'; }
    },
    onStateChange: async ({ event }) => events.push(event)
  });
  assert.equal(plan.status, 'completed');
  assert.deepEqual(calls, ['reasoning', 'compose']);
  assert.ok(events.includes('plan_created'));
  assert.ok(events.includes('plan_completed'));
});

test('external tools require the exact approval hash', async () => {
  let executed = false;
  const plan = await runOrchestratedPlan({
    task,
    accountPlan: 'pro',
    legacyPlan: legacyPlan([{ id: 'send', tool: 'send_email', input: { body: 'ciao' } }]),
    handlers: { send_email: async () => { executed = true; return { sent: true }; } },
    approve: async ({ approvalHash }) => approvalHash
  });
  assert.equal(plan.status, 'completed');
  assert.equal(executed, true);
});

test('missing approval prevents external execution', async () => {
  let executed = false;
  await assert.rejects(runOrchestratedPlan({
    task,
    accountPlan: 'pro',
    legacyPlan: legacyPlan([{ id: 'send', tool: 'send_email' }]),
    handlers: { send_email: async () => { executed = true; } }
  }), (error) => error.code === 'approval_required');
  assert.equal(executed, false);
});

test('missing handlers fail the plan without running dependents', async () => {
  let composed = false;
  const plan = await runOrchestratedPlan({
    task,
    legacyPlan: legacyPlan([
      { id: 'research', tool: 'web_search', maxAttempts: 1 },
      { id: 'compose', tool: 'compose' }
    ]),
    handlers: { compose: async () => { composed = true; } }
  });
  assert.equal(plan.status, 'failed');
  assert.equal(plan.state.research.status, 'failed');
  assert.equal(plan.state.compose.status, 'blocked');
  assert.equal(composed, false);
});
