'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ResultRecoverySupervisor } = require('../app/services/resultRecoverySupervisor');

test('switches to a fallback tool after a permanent primary failure', async () => {
  const calls = [];
  const runtime = {
    async execute(request) {
      calls.push(request.toolId);
      if (request.toolId === 'primary.tool') throw Object.assign(new Error('broken'), { code: 'PERMANENT_ERROR' });
      return { executionId: 'fallback-run', result: { ok: true }, verification: { passed: true } };
    }
  };
  const supervisor = new ResultRecoverySupervisor({ runtime });
  const result = await supervisor.run({ toolId: 'primary.tool' }, {
    maxAttempts: 3,
    fallbackToolId: 'backup.tool',
    assertions: [{ id: 'ok', test: (value) => value.ok === true }]
  });
  assert.deepEqual(calls, ['primary.tool', 'backup.tool']);
  assert.equal(result.attempts, 2);
});
