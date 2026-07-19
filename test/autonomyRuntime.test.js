'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlan } = require('../app/services/autonomousPlanner');
const { WorkingMemory, evaluateResult, runBrowserAutopilot, runAutonomyRuntime } = require('../app/services/autonomyRuntime');

function planFixture() {
  return createPlan({
    goal: 'Completa un task verificabile',
    taskId: 'runtime-1',
    steps: [{ id: 'one', title: 'Uno', tool: 'reasoning', maxAttempts: 1 }]
  });
}

test('working memory ranks relevant memories', async () => {
  const memory = new WorkingMemory();
  await memory.remember({ kind: 'fact', content: 'Il cliente preferisce report PDF', importance: 0.5 });
  await memory.remember({ kind: 'fact', content: 'Il colore del logo è blu', importance: 0.9 });
  const results = memory.recall('report cliente PDF');
  assert.equal(results[0].content, 'Il cliente preferisce report PDF');
});

test('result evaluator detects missing contract keys', () => {
  const evaluation = evaluateResult({ result: { ok: true }, criteria: { requiredKeys: ['data'] }, step: { id: 'one' } });
  assert.equal(evaluation.passed, false);
  assert.deepEqual(evaluation.failures, ['missing_key:data']);
});

test('browser autopilot only executes allowlisted actions', async () => {
  let calls = 0;
  const result = await runBrowserAutopilot({
    goal: 'Leggi la pagina',
    allowedActions: ['read'],
    observe: async () => calls++ ? { done: true, result: 'ok' } : { done: false, nextAction: { type: 'read' } },
    act: async () => ({ text: 'pagina' })
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.history.length, 1);
});

test('browser autopilot blocks unapproved side effects', async () => {
  await assert.rejects(() => runBrowserAutopilot({
    goal: 'Invia modulo',
    allowedActions: ['submit'],
    observe: async () => ({ done: false, nextAction: { type: 'submit', requiresApproval: true } }),
    act: async () => ({ ok: true })
  }), { code: 'approval_required' });
});

test('autonomy runtime checkpoints, recalls memory and completes', async () => {
  const checkpoints = [];
  const memory = new WorkingMemory();
  const completed = await runAutonomyRuntime({
    plan: planFixture(),
    memory,
    checkpoint: async (snapshot, event) => checkpoints.push({ status: snapshot.status, type: event.type }),
    criteriaForStep: () => ({ requiredKeys: ['data'] }),
    execute: async ({ memory: recalled }) => ({ data: 'ok', recalled: recalled.length })
  });
  assert.equal(completed.status, 'completed');
  assert.ok(checkpoints.some((entry) => entry.type === 'step_completed'));
  assert.ok(memory.recall('step one', { limit: 10 }).length > 0);
});

test('autonomy runtime replans after a semantically invalid result', async () => {
  let executions = 0;
  const completed = await runAutonomyRuntime({
    plan: planFixture(),
    maxReplans: 1,
    criteriaForStep: () => ({ requiredKeys: ['data'] }),
    execute: async ({ step }) => {
      executions += 1;
      if (step.id === 'one') return { wrong: true };
      return { data: 'repaired' };
    }
  });
  assert.equal(completed.status, 'completed');
  assert.ok(completed.metadata.replanCount >= 1);
  assert.equal(executions, 2);
});
