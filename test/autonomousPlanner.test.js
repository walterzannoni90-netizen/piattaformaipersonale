'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createPlan,
  nextRunnable,
  startStep,
  completeStep,
  failStep,
  approvalHash,
  executePlan
} = require('../app/services/autonomousPlanner');

test('executes dependency graph in deterministic order', async () => {
  const plan = createPlan({
    goal: 'Analyze and publish a report',
    steps: [
      { id: 'research', tool: 'web_search' },
      { id: 'analyze', tool: 'python_analyze', dependsOn: ['research'] },
      { id: 'compose', tool: 'compose', dependsOn: ['analyze'] }
    ]
  });
  const order = [];
  await executePlan(plan, async ({ step }) => {
    order.push(step.id);
    return { ok: true };
  });
  assert.deepEqual(order, ['research', 'analyze', 'compose']);
  assert.equal(plan.status, 'completed');
});

test('retries transient failures up to maxAttempts', async () => {
  const plan = createPlan({ goal: 'Retry safely', steps: [{ id: 'unstable', maxAttempts: 2 }] });
  let calls = 0;
  await executePlan(plan, async () => {
    calls += 1;
    if (calls === 1) throw new Error('temporary');
    return 'done';
  });
  assert.equal(calls, 2);
  assert.equal(plan.state.unstable.status, 'completed');
  assert.equal(plan.state.unstable.attempts, 2);
});

test('blocks dependent work after permanent failure', () => {
  const plan = createPlan({
    goal: 'Stop unsafe continuation',
    steps: [
      { id: 'first', maxAttempts: 1 },
      { id: 'second', dependsOn: ['first'] }
    ]
  });
  startStep(plan, 'first');
  failStep(plan, 'first', new Error('fatal'));
  assert.equal(plan.state.first.status, 'failed');
  assert.equal(nextRunnable(plan), null);
  assert.equal(plan.state.second.status, 'blocked');
  assert.equal(plan.status, 'failed');
});

test('requires exact approval hash for side effects', () => {
  const plan = createPlan({
    goal: 'Send approved message',
    taskId: 'task-1',
    steps: [{ id: 'send', tool: 'send_email', input: { to: 'user@example.com' }, approvalRequired: true }]
  });
  const expected = approvalHash(plan, plan.steps[0]);
  assert.throws(() => startStep(plan, 'send'), (error) => error.code === 'approval_required' && error.approvalHash === expected);
  assert.throws(() => startStep(plan, 'send', 'wrong'), (error) => error.code === 'approval_required');
  startStep(plan, 'send', expected);
  completeStep(plan, 'send', { sent: true });
  assert.equal(plan.status, 'completed');
});

test('rejects cycles and unknown dependencies', () => {
  assert.throws(() => createPlan({
    goal: 'Cycle',
    steps: [{ id: 'a', dependsOn: ['b'] }, { id: 'b', dependsOn: ['a'] }]
  }), /ciclo/);
  assert.throws(() => createPlan({
    goal: 'Unknown',
    steps: [{ id: 'a', dependsOn: ['missing'] }]
  }), /Dipendenza sconosciuta/);
});
