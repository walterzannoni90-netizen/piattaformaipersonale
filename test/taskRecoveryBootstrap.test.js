'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlan, startStep, completeStep } = require('../app/services/autonomousPlanner');
const { currentStep } = require('../app/services/taskStateStore');
const { isSnapshotPlan, flattenSnapshot, prepareRecoverableTasks } = require('../app/services/taskRecoveryBootstrap');

function planFixture() {
  return createPlan({
    goal: 'Riprendi il task',
    taskId: 'task-1',
    steps: [
      { id: 'one', title: 'Primo', tool: 'reasoning' },
      { id: 'two', title: 'Secondo', tool: 'compose', dependsOn: ['one'] }
    ]
  });
}

function fakeDb(rows) {
  const updates = [];
  return {
    updates,
    prepare(sql) {
      return {
        all() { return rows; },
        run(...args) { updates.push({ sql, args }); return { changes: 1 }; }
      };
    }
  };
}

test('currentStep returns a numeric cursor compatible with runTask', () => {
  const plan = planFixture();
  assert.equal(currentStep(plan), 0);
  startStep(plan, 'one');
  completeStep(plan, 'one', { ok: true });
  assert.equal(currentStep(plan), 1);
});

test('flattenSnapshot resets interrupted work and preserves completed cursor', () => {
  const plan = planFixture();
  startStep(plan, 'one');
  const restored = flattenSnapshot(JSON.stringify(plan));
  assert.equal(restored.currentStep, 0);
  assert.equal(restored.status, 'pending');
  assert.equal(Array.isArray(JSON.parse(restored.plan)), true);
});

test('bootstrap converts snapshot tasks for the legacy runTask loop', () => {
  const plan = planFixture();
  const db = fakeDb([{ id: 'task-1', plan: JSON.stringify(plan), status: 'running', cancel_requested: 0 }]);
  const result = prepareRecoverableTasks(db);
  assert.deepEqual(result, { scanned: 1, converted: 1, invalid: 0 });
  assert.equal(db.updates.length, 1);
  assert.equal(typeof db.updates[0].args[1], 'number');
});

test('invalid snapshots are not mistaken for autonomous state', () => {
  assert.equal(isSnapshotPlan('[{"tool":"reasoning"}]'), false);
  assert.equal(isSnapshotPlan('{broken'), false);
});
