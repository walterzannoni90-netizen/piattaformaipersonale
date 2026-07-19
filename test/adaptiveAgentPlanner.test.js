'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createHierarchicalPlan,
  expandTask,
  reprioritize,
  proposeRecovery,
  detectExecutionLoop
} = require('../app/services/adaptiveAgentPlanner');

test('creates and expands an acyclic hierarchical plan', () => {
  const plan = createHierarchicalPlan({
    goal: 'Pubblicare e verificare una pagina',
    tasks: [
      { id: 'build', title: 'Costruisci', action: 'code' },
      { id: 'verify', title: 'Verifica', action: 'browser', dependencies: ['build'] }
    ]
  });

  const children = expandTask(plan, 'build', [
    { id: 'frontend', title: 'Frontend', action: 'code' },
    { id: 'backend', title: 'Backend', action: 'code', dependencies: ['frontend'] }
  ]);

  assert.equal(plan.revision, 2);
  assert.equal(children.length, 2);
  assert.equal(children[0].parentId, 'build');
});

test('rejects cyclic plans', () => {
  assert.throws(() => createHierarchicalPlan({
    goal: 'Ciclo',
    tasks: [
      { id: 'a', dependencies: ['b'] },
      { id: 'b', dependencies: ['a'] }
    ]
  }), /ciclo/i);
});

test('reprioritizes critical tasks and proposes bounded recovery', () => {
  const plan = createHierarchicalPlan({
    goal: 'Recupera una richiesta',
    tasks: [{ id: 'request', title: 'Richiesta', metadata: { fallbackAction: 'safeWeb' }, maxAttempts: 3 }]
  });

  reprioritize(plan, { criticalTaskIds: ['request'] });
  assert.equal(plan.tasks[0].priority, -100);

  const retry = proposeRecovery(plan, { taskId: 'request', code: 'ETIMEDOUT', attempts: 1 });
  assert.equal(retry.strategy, 'retry');
  assert.equal(retry.delayMs, 1000);

  const fallback = proposeRecovery(plan, { taskId: 'request', code: 'PERMANENT', attempts: 3 });
  assert.equal(fallback.strategy, 'fallback');
  assert.equal(fallback.replacement.action, 'safeWeb');
});

test('detects repeated execution loops', () => {
  const history = Array.from({ length: 3 }, () => ({ taskId: 'same', action: 'browser', code: 'ERROR', outcome: 'failed' }));
  assert.equal(detectExecutionLoop(history), true);
  assert.equal(detectExecutionLoop(history.slice(0, 2)), false);
});
