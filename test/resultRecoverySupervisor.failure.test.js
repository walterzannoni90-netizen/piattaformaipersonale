'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ResultRecoverySupervisor } = require('../app/services/resultRecoverySupervisor');

test('fails conclusively when no recovery path is available', async () => {
  const runtime = { async execute() { throw Object.assign(new Error('fatal'), { code: 'FATAL' }); } };
  const supervisor = new ResultRecoverySupervisor({ runtime });
  await assert.rejects(
    supervisor.run({}, { maxAttempts: 2 }),
    (error) => error.code === 'FATAL' && error.recovery?.action === 'fail'
  );
});
