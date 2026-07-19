'use strict';

const { benchmarkOperationalRunner } = require('../app/services/runtimeOperations');

const cases = [
  { id: 'deterministic-output', input: { value: 2 }, verify: (output) => output.value === 2 },
  { id: 'structured-result', input: { status: 'completed' }, verify: (output) => output && output.status === 'completed' }
];

(async () => {
  const report = await benchmarkOperationalRunner(cases, async (testCase) => ({ ...testCase.input }));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.failed > 0) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});