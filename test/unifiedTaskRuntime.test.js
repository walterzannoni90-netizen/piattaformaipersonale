'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { runUnifiedTaskRuntime } = require('../app/services/unifiedTaskRuntime');

function task() {
  return {
    id: 'task-unified-runtime',
    user_id: 'user-1',
    project_id: 'project-1',
    prompt: 'Crea un risultato verificato',
    mode: 'autonomous'
  };
}

test('unified runtime converts and executes a persisted legacy plan', async () => {
  const events = [];
  const checkpoints = [];
  const result = await runUnifiedTaskRuntime({
    task: task(),
    legacyPlan: {
      title: 'Piano compatibile',
      steps: [
        { id: 'prepare', title: 'Prepara', tool: 'reasoning', input: {} },
        { id: 'deliver', title: 'Consegna', tool: 'compose', input: {} }
      ]
    },
    handlers: {
      reasoning: async () => ({ note: 'ok' }),
      compose: async () => ({ deliverable: 'Risultato completo e verificato.' })
    },
    checkpoint: async (plan, event) => checkpoints.push({ status: plan.status, type: event.type }),
    evaluate: async () => ({ accepted: true, score: 1 }),
    onEvent: async (event) => events.push(event.type)
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.state.prepare.status, 'completed');
  assert.equal(result.state.deliver.status, 'completed');
  assert.ok(checkpoints.length >= 4);
  assert.ok(events.includes('execution_started'));
  assert.ok(events.includes('execution_completed'));
});

test('unified runtime refuses missing tool handlers', async () => {
  await assert.rejects(
    runUnifiedTaskRuntime({
      task: task(),
      legacyPlan: {
        title: 'Piano non eseguibile',
        steps: [{ id: 'missing', title: 'Manca', tool: 'unknown_tool', input: {}, maxAttempts: 1 }]
      },
      handlers: {},
      evaluate: async () => ({ accepted: true })
    }),
    /Handler non disponibile/
  );
});
