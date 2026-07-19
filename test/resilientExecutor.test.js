'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlan } = require('../app/services/autonomousPlanner');
const { runResilientPlan, mergeReplan, defaultRetryPolicy } = require('../app/services/resilientExecutor');

function fixture(maxAttempts = 2) {
  return createPlan({
    goal: 'Completa il lavoro',
    taskId: 'task-resilient',
    steps: [
      { id: 'research', title: 'Ricerca', tool: 'web_search', maxAttempts },
      { id: 'compose', title: 'Componi', tool: 'compose', dependsOn: ['research'] }
    ]
  });
}

test('checkpoints after every state transition and completes', async () => {
  const checkpoints = [];
  const result = await runResilientPlan({
    plan: fixture(),
    execute: async ({ step }) => ({ ok: step.id }),
    checkpoint: async (plan, event) => checkpoints.push({ status: plan.status, type: event.type })
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.state.research.status, 'completed');
  assert.equal(result.state.compose.status, 'completed');
  assert.ok(checkpoints.some((item) => item.type === 'step_started'));
  assert.ok(checkpoints.some((item) => item.type === 'step_completed'));
  assert.equal(checkpoints.at(-1).type, 'execution_completed');
});

test('retries transient failures without replanning', async () => {
  let calls = 0;
  const result = await runResilientPlan({
    plan: fixture(2),
    execute: async ({ step }) => {
      if (step.id === 'research' && calls++ === 0) throw new Error('temporaneo');
      return { ok: true };
    }
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.state.research.attempts, 2);
});

test('replans after a permanent non-external failure', async () => {
  const original = fixture(1);
  let replanned = false;
  const result = await runResilientPlan({
    plan: original,
    execute: async ({ step }) => {
      if (step.id === 'research' && !replanned) throw new Error('fonte non disponibile');
      return { ok: true };
    },
    replan: async () => {
      replanned = true;
      return createPlan({
        goal: original.goal,
        taskId: original.id,
        steps: [
          { id: 'fallback', title: 'Fallback', tool: 'reasoning' },
          { id: 'compose', title: 'Componi', tool: 'compose', dependsOn: ['fallback'] }
        ]
      });
    }
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.metadata.replanCount, 1);
  assert.equal(result.state.fallback.status, 'completed');
});

test('does not retry uncertain external actions', () => {
  const error = new Error('incerto');
  error.code = 'EXTERNAL_ACTION_UNCERTAIN';
  assert.equal(defaultRetryPolicy({ error, attempt: 1, step: { maxAttempts: 3, approvalRequired: true } }), false);
});

test('mergeReplan preserves completed results with matching ids', () => {
  const oldPlan = fixture();
  oldPlan.state.research.status = 'completed';
  oldPlan.state.research.result = { sources: 3 };
  const replacement = fixture();
  const merged = mergeReplan(oldPlan, replacement);
  assert.equal(merged.state.research.status, 'completed');
  assert.deepEqual(merged.state.research.result, { sources: 3 });
});
