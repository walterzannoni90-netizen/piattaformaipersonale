'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPlan, startStep, completeStep, failStep } = require('../app/services/autonomousPlanner');
const {
  RuntimePersistenceAdapter,
  fingerprint,
  runtimeStatus,
  eventPresentation
} = require('../app/services/runtimePersistenceAdapter');

function fakeDb(initial = {}) {
  const row = {
    id: 'task-1',
    user_id: 'user-1',
    plan: null,
    status: 'pending',
    progress: 0,
    current_step: 0,
    error: null,
    needs_approval: 0,
    completed_at: null,
    result: null,
    credits_used: 0,
    ...initial
  };
  return {
    row,
    prepare(sql) {
      return {
        get() {
          if (/SELECT user_id/.test(sql)) return { user_id: row.user_id };
          if (/SELECT plan/.test(sql)) return { plan: row.plan };
          if (/SELECT completed_at/.test(sql)) return { completed_at: row.completed_at };
          throw new Error(`Unsupported get: ${sql}`);
        },
        run(...args) {
          if (/SET plan = \?, current_step/.test(sql)) {
            [row.plan, row.current_step, row.progress, row.status, row.error, row.needs_approval] = args;
            return { changes: 1 };
          }
          if (/cancel_requested = 0/.test(sql)) {
            row.plan = args[0];
            row.status = 'stopped';
            return { changes: 1 };
          }
          if (/SET status = \?, progress = 100/.test(sql)) {
            row.status = args[0];
            row.progress = 100;
            row.result = args[1];
            row.error = null;
            row.needs_approval = 0;
            row.completed_at = args[2];
            if (args.length === 5) row.credits_used = args[3];
            return { changes: 1 };
          }
          throw new Error(`Unsupported run: ${sql}`);
        }
      };
    }
  };
}

function plan() {
  return createPlan({
    taskId: 'task-1',
    goal: 'Consegna un report verificato',
    steps: [
      { id: 'research', title: 'Ricerca', tool: 'web_search', input: {}, maxAttempts: 2 },
      { id: 'compose', title: 'Componi', tool: 'compose', input: {}, dependsOn: ['research'] }
    ]
  });
}

test('fingerprint is deterministic across object key order', () => {
  assert.equal(fingerprint({ b: 2, a: 1 }), fingerprint({ a: 1, b: 2 }));
  assert.notEqual(fingerprint({ a: 1 }), fingerprint({ a: 2 }));
});

test('adapter persists full snapshots, progress and structured events', () => {
  const db = fakeDb();
  const events = [];
  const adapter = new RuntimePersistenceAdapter({ db, taskId: 'task-1', userId: 'user-1', eventWriter: (event) => events.push(event) });
  const current = plan();
  adapter.save(current, { type: 'execution_started', plan: current });
  assert.equal(db.row.status, 'pending');
  assert.equal(db.row.progress, 0);
  assert.equal(JSON.parse(db.row.plan).state.research.status, 'pending');

  startStep(current, 'research');
  adapter.save(current, { type: 'step_started', step: current.steps[0], attempt: 1, plan: current });
  assert.equal(db.row.status, 'running');
  assert.equal(db.row.current_step, 0);

  completeStep(current, 'research', { sources: 4 });
  adapter.save(current, { type: 'step_completed', step: current.steps[0], result: { sources: 4 }, plan: current });
  assert.equal(db.row.progress, 50);
  assert.equal(events.length, 3);
  assert.equal(events[2].metadata.tool, 'web_search');
  assert.match(events[2].metadata.snapshotHash, /^[a-f0-9]{64}$/);
});

test('adapter maps approval and configuration states without losing snapshot', () => {
  const db = fakeDb();
  const adapter = new RuntimePersistenceAdapter({ db, taskId: 'task-1', userId: 'user-1' });
  const current = plan();
  adapter.save(current, { type: 'approval_required', approvalHash: 'abc', plan: current });
  assert.equal(db.row.status, 'waiting_approval');
  assert.equal(db.row.needs_approval, 1);

  adapter.save(current, { type: 'step_failed', code: 'AI_NOT_CONFIGURED', error: 'Configura OpenRouter', plan: current });
  assert.equal(db.row.status, 'waiting_configuration');
  assert.equal(db.row.error, 'Configura OpenRouter');
  assert.equal(JSON.parse(db.row.plan).id, 'task-1');
});

test('delivery claim is idempotent and requires a completed plan', () => {
  const db = fakeDb();
  const adapter = new RuntimePersistenceAdapter({ db, taskId: 'task-1', userId: 'user-1', now: () => '2026-07-19T13:00:00.000Z' });
  const current = plan();
  assert.equal(adapter.claimDelivery(current), false);
  startStep(current, 'research');
  completeStep(current, 'research', {});
  startStep(current, 'compose');
  completeStep(current, 'compose', { deliverable: 'ok' });
  assert.equal(adapter.claimDelivery(current), true);
  assert.equal(adapter.claimDelivery(current), false);
  adapter.completeDelivery({ result: 'Report finale', creditsUsed: 7 });
  assert.equal(db.row.status, 'completed');
  assert.equal(db.row.completed_at, '2026-07-19T13:00:00.000Z');
  assert.equal(db.row.credits_used, 7);
});

test('adapter records failed attempts and can cancel pending work', () => {
  const db = fakeDb();
  const adapter = new RuntimePersistenceAdapter({ db, taskId: 'task-1', userId: 'user-1' });
  const current = plan();
  startStep(current, 'research');
  const error = Object.assign(new Error('Rete non disponibile'), { code: 'NETWORK_ERROR' });
  failStep(current, 'research', error);
  adapter.save(current, { type: 'step_retry_scheduled', step: current.steps[0], attempt: 1, error: error.message, code: error.code, plan: current });
  assert.equal(JSON.parse(db.row.plan).state.research.attempts, 1);
  const cancelled = adapter.markCancelled(current);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(db.row.status, 'stopped');
});

test('ownership mismatch is rejected before reads or writes', () => {
  const db = fakeDb({ user_id: 'other-user' });
  const adapter = new RuntimePersistenceAdapter({ db, taskId: 'task-1', userId: 'user-1' });
  assert.throws(() => adapter.load(), /non accessibile/);
  assert.throws(() => adapter.save(plan()), /non accessibile/);
});

test('status and event helpers expose stable UI contracts', () => {
  const current = plan();
  assert.equal(runtimeStatus(current, { type: 'approval_required' }), 'waiting_approval');
  assert.equal(runtimeStatus(current, { type: 'step_failed', code: 'WEB_NOT_CONFIGURED' }), 'waiting_configuration');
  const view = eventPresentation({ type: 'step_failed', step: current.steps[0], error: 'boom', code: 'X' });
  assert.equal(view.status, 'failed');
  assert.equal(view.metadata.code, 'X');
  assert.match(view.detail, /boom/);
});