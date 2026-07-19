'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ResultRecoverySupervisor } = require('../app/services/resultRecoverySupervisor');

test('surfaces human intervention requirements without retrying', async () => {
  let calls = 0;
  const runtime = {
    async execute() {
      calls += 1;
      throw Object.assign(new Error('login required'), { code: 'AUTH_REQUIRED' });
    }
  };
  const supervisor = new ResultRecoverySupervisor({ runtime });
  await assert.rejects(
    supervisor.run({}, { maxAttempts: 3 }),
    (error) => error.recovery?.action === 'human' && error.history.length === 1
  );
  assert.equal(calls, 1);
});
