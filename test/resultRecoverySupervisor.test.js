'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ResultRecoverySupervisor, scoreResult, chooseRecovery } = require('../app/services/resultRecoverySupervisor');

test('scores weighted result assertions', () => {
  const evaluation = scoreResult({
    result: { value: 10, complete: true },
    assertions: [
      { id: 'value', weight: 2, test: (result) => result.value === 10 },
      { id: 'complete', weight: 1, test: (result) => result.complete === true }
    ]
  });
  assert.equal(evaluation.passed, true);
  assert.equal(evaluation.score, 1);
});

test('selects retry, replan, fallback and human recovery paths', () => {
  assert.equal(chooseRecovery({ code: 'TOOL_TIMEOUT' }, { attempt: 1, maxAttempts: 3 }).action, 'retry');
  assert.equal(chooseRecovery({ code: 'VERIFICATION_FAILED' }, { attempt: 1, maxAttempts: 3 }).action, 'replan');
  assert.equal(chooseRecovery({ code: 'ERROR' }, { attempt: 1, maxAttempts: 3, fallbackToolId: 'backup.tool' }).action, 'fallback');
  assert.equal(chooseRecovery({ code: 'AUTH_REQUIRED' }, { attempt: 1, maxAttempts: 3 }).action, 'human');
});

test('retries transient failures and returns verified output', async () => {
  let calls = 0;
  const runtime = {
    async execute() {
      calls += 1;
      if (calls === 1) throw Object.assign(new Error('temporary'), { code: 'TOOL_TIMEOUT' });
      return { executionId: 'done', result: { answer: 7 }, verification: { passed: true } };
    }
  };
  const supervisor = new ResultRecoverySupervisor({ runtime, sleep: async () => {} });
  const result = await supervisor.run({}, {
    maxAttempts: 3,
    assertions: [{ id: 'answer', test: (value) => value.answer === 7 }]
  });
  assert.equal(result.attempts, 2);
  assert.equal(result.evaluation.passed, true);
  assert.equal(calls, 2);
});

test('replans after assertion failure', async () => {
  const requests = [];
  const runtime = {
    async execute(request) {
      requests.push(request);
      return {
        executionId: `run-${requests.length}`,
        result: { valid: request.version === 2 },
        verification: { passed: true }
      };
    }
  };
  const planner = {
    async replan({ request }) {
      return { ...request, version: 2 };
    }
  };
  const supervisor = new ResultRecoverySupervisor({ runtime, planner, sleep: async () => {} });
  const result = await supervisor.run({ version: 1 }, {
    maxAttempts: 3,
    assertions: [{ id: 'valid', test: (value) => value.valid === true }]
  });
  assert.equal(result.attempts, 2);
  assert.equal(requests[1].version, 2);
});

test('records execution events in durable memory when configured', async () => {
  const events = [];
  const memory = { async appendEvent(key, event) { events.push({ key, event }); } };
  const runtime = { async execute() { return { executionId: 'memory-run', result: { ok: true }, verification: { passed: true } }; } };
  const supervisor = new ResultRecoverySupervisor({ runtime, memory });
  await supervisor.run({}, { memoryKey: 'task-1' });
  assert.equal(events.length, 1);
  assert.equal(events[0].key, 'task-1');
  assert.equal(events[0].event.type, 'tool_execution_completed');
});
