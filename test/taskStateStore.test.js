'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TaskStateStore, recoverInterrupted, progress } = require('../app/services/taskStateStore');

function fakeDb(initialPlan = null) {
  const row = { plan: initialPlan, status: null, current_step: null, progress: null };
  return {
    row,
    prepare(sql) {
      return {
        run(plan, currentStep, value, status) {
          if (/UPDATE/.test(sql)) Object.assign(row, { plan, current_step: currentStep, progress: value, status });
        },
        get() { return row.plan ? { plan: row.plan } : null; }
      };
    }
  };
}

function sample(status = 'running') {
  return {
    id: 'task-1', status,
    steps: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }],
    state: {
      a: { status: 'completed', attempts: 1 },
      b: { status: status === 'completed' ? 'completed' : 'running', attempts: 1, startedAt: '2026-01-01T00:00:00Z' }
    },
    metadata: {}
  };
}

test('persists snapshot progress and task status', () => {
  const db = fakeDb();
  const store = new TaskStateStore({ db });
  store.save('task-1', sample());
  assert.equal(db.row.progress, 50);
  assert.equal(db.row.status, 'running');
  assert.equal(db.row.current_step, 'B');
});

test('recovers interrupted running steps as pending', () => {
  const recovered = recoverInterrupted(sample());
  assert.equal(recovered.status, 'pending');
  assert.equal(recovered.state.b.status, 'pending');
  assert.match(recovered.state.b.error, /riavvio/);
  assert.ok(recovered.metadata.recoveredAt);
});

test('load persists recovered snapshot', () => {
  const db = fakeDb(JSON.stringify(sample()));
  const store = new TaskStateStore({ db });
  const loaded = store.load('task-1');
  assert.equal(loaded.state.b.status, 'pending');
  assert.equal(JSON.parse(db.row.plan).state.b.status, 'pending');
});

test('terminal plans are not modified', () => {
  const completed = sample('completed');
  const recovered = recoverInterrupted(completed);
  assert.equal(recovered.status, 'completed');
  assert.equal(progress(recovered), 100);
});
