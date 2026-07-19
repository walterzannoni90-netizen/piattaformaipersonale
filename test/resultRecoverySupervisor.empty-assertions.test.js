'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scoreResult } = require('../app/services/resultRecoverySupervisor');

test('treats an empty assertion set as fully verified', () => {
  const result = scoreResult({ result: { anything: true }, assertions: [] });
  assert.equal(result.passed, true);
  assert.equal(result.score, 1);
  assert.deepEqual(result.checks, []);
});
