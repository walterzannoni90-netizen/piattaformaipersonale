'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ResultRecoverySupervisor } = require('../app/services/resultRecoverySupervisor');

test('journals failed tool attempts before surfacing the error', async () => {
  const events = [];
  const memory = { async appendEvent(key, event) { events.push({ key, event }); } };
  const runtime = { async execute() { throw Object.assign(new Error('fatal'), { code: 'FATAL' }); } };
  const supervisor = new ResultRecoverySupervisor({ runtime, memory });
  await assert.rejects(supervisor.run({}, { memoryKey: 'task-failure' }));
  assert.equal(events[0].key, 'task-failure');
  assert.equal(events[0].event.type, 'tool_execution_failed');
  assert.equal(events[0].event.recovery.action, 'fail');
});
