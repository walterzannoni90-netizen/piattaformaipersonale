const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const workspaceRoot = path.join('/tmp', `wes-python-${process.pid}`);
process.env.AGENT_WORKSPACE_ROOT = workspaceRoot;
process.env.APP_ENCRYPTION_KEY = crypto.randomBytes(32).toString('hex');

test('restricted Python performs safe calculations and blocks code execution', async (t) => {
  t.after(() => fs.rmSync(workspaceRoot, { recursive: true, force: true }));
  const { runPythonOperation } = require('../app/services/pythonRunner');
  const result = await runPythonOperation({ userId: 'user-a', taskId: 'task-a', operation: 'calculate', payload: { expression: 'sqrt(144) + 18 / 3' } });
  assert.equal(result.result, 18);
  await assert.rejects(
    runPythonOperation({ userId: 'user-a', taskId: 'task-a', operation: 'calculate', payload: { expression: "__import__('os').system('id')" } }),
    /non consentita/
  );
});

test('workspace rejects traversal and analyzes only files inside the task directory', async () => {
  const fileStore = require('../app/services/fileStore');
  const { runPythonOperation } = require('../app/services/pythonRunner');
  assert.throws(() => fileStore.ensureInsideRoot('/etc/passwd'), /Percorso workspace non valido/);
  const stored = fileStore.saveUpload({
    userId: 'user-a', taskId: 'task-csv',
    file: { originalname: 'sales.csv', mimetype: 'text/csv', size: 35, buffer: Buffer.from('name,revenue\nA,100\nB,250\nC,150\n') }
  });
  const result = await runPythonOperation({ userId: 'user-a', taskId: 'task-csv', operation: 'analyze_csv', payload: { file: stored.storedName } });
  assert.equal(result.summary.rows, 3);
  assert.equal(result.summary.fields.revenue.mean, 500 / 3);
  assert.throws(() => fileStore.validateUpload({
    originalname: 'contratto.pdf', mimetype: 'application/pdf', size: 12,
    buffer: Buffer.from('not-a-pdf-file')
  }), /Firma PDF/);
  assert.throws(() => fileStore.validateUpload({
    originalname: 'foto.jpg', mimetype: 'image/png', size: 12,
    buffer: Buffer.from('not-an-image')
  }), /Estensione|Firma/);
});

test('Python creates real Markdown and PDF deliverables inside the private task workspace', async () => {
  const { runPythonOperation } = require('../app/services/pythonRunner');
  const result = await runPythonOperation({
    userId: 'user-a', taskId: 'task-report', operation: 'create_report',
    payload: { title: 'Report vendite', sections: [{ title: 'Sintesi', content: 'Risultato verificato.' }] },
    timeoutMs: 25_000
  });
  const pdf = result.artifacts.find((artifact) => artifact.type === 'application/pdf');
  const markdown = result.artifacts.find((artifact) => artifact.type === 'text/markdown');
  assert.ok(pdf && markdown);
  assert.equal(fs.readFileSync(pdf.path).subarray(0, 4).toString(), '%PDF');
  assert.match(fs.readFileSync(markdown.path, 'utf8'), /Report vendite/);
});

test('web guard rejects private network targets', async () => {
  const { validatePublicUrl, isPrivateIp } = require('../app/services/safeWeb');
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('10.0.0.3'), true);
  assert.equal(isPrivateIp('169.254.169.254'), true);
  assert.equal(isPrivateIp('203.0.113.20'), true);
  assert.equal(isPrivateIp('ff02::1'), true);
  assert.equal(isPrivateIp('64:ff9b::7f00:1'), true);
  assert.equal(isPrivateIp('2002:7f00:1::'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
  await assert.rejects(validatePublicUrl('http://127.0.0.1/admin'), /privata|riservata/);
  await assert.rejects(validatePublicUrl('file:///etc/passwd'), /Protocollo/);
});

test('planner normalizes unknown tools and preserves mandatory delivery steps', () => {
  const { validatePlan, fallbackPlan } = require('../app/services/agentOrchestrator');
  const fallback = fallbackPlan('Crea un report sui concorrenti', false);
  const plan = validatePlan({ title: 'Test', steps: [{ title: 'Shell', tool: 'terminal_root', input: { command: 'rm -rf /' } }] }, fallback);
  assert.equal(plan.steps[0].tool, 'reasoning');
  assert.ok(plan.steps.some((step) => step.tool === 'compose'));
  assert.ok(plan.steps.some((step) => step.tool === 'quality_review'));
  const actionable = validatePlan({ title: 'Invio', steps: [
    { title: 'Invia', tool: 'send_email', input: { to: 'cliente@example.com', body: '$deliverable' } },
    { title: 'Analizza', tool: 'reasoning', input: {} }
  ] }, fallback);
  assert.ok(actionable.steps.findIndex((step) => step.tool === 'send_email') > actionable.steps.findIndex((step) => step.tool === 'quality_review'));
});

test('connector secrets are authenticated and encrypted at rest', () => {
  const { seal, open } = require('../app/services/secretVault');
  const privateValue = crypto.randomBytes(24).toString('base64url');
  const encrypted = seal(privateValue);
  assert.notEqual(encrypted, privateValue);
  assert.match(encrypted, /^enc:v1:/);
  assert.equal(open(encrypted), privateValue);
  assert.throws(() => open(`${encrypted.slice(0, -2)}aa`));
});

test('scheduled tasks calculate the next run in the requested timezone', () => {
  const { nextRun } = require('../app/services/scheduleService');
  const next = nextRun('0 9 * * 1-5', 'Europe/Rome', new Date('2026-07-17T12:00:00.000Z'));
  assert.ok(next instanceof Date);
  assert.ok(next > new Date('2026-07-17T12:00:00.000Z'));
});

test('Markdown deliverables render formatting but never execute embedded HTML', () => {
  const { renderMarkdown } = require('../app/services/markdown');
  const output = renderMarkdown('# Report\n\n<script>alert(1)</script>\n\n[fonte](https://example.com)');
  assert.match(output, /<h1>Report<\/h1>/);
  assert.doesNotMatch(output, /<script>/);
  assert.match(output, /&lt;script&gt;/);
  assert.match(output, /noopener noreferrer nofollow/);
});

test('commercial agent prompt parses stored JSON and resists prompt injection', () => {
  const { buildSystemPrompt } = require('../app/services/openrouter');
  const prompt = buildSystemPrompt({
    name: 'WES Sales', company_name: 'Azienda',
    qualification_questions: JSON.stringify([{ question: 'Qual è il budget?', required: true }])
  });
  assert.match(prompt, /Qual è il budget/);
  assert.match(prompt, /contenuto non attendibile/);
});
