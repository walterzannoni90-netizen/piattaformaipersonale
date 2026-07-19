const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');

const port = 33_000 + (process.pid % 1_000);
const baseUrl = `http://127.0.0.1:${port}`;
const dbFile = path.join('/tmp', `wes-http-e2e-${process.pid}.db`);
const workspaceRoot = path.join('/tmp', `wes-http-workspace-${process.pid}`);
const accountPassword = `${crypto.randomBytes(18).toString('base64url')}!9a`;
try { fs.unlinkSync(dbFile); } catch {}

Object.assign(process.env, {
  NODE_ENV: 'test',
  PORT: String(port),
  APP_URL: baseUrl,
  ALLOW_PUBLIC_REGISTRATION: 'true',
  JWT_SECRET: crypto.randomBytes(32).toString('hex'),
  APP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'),
  DB_PATH: dbFile,
  AGENT_WORKSPACE_ROOT: workspaceRoot,
  PYTHON_BIN: process.env.PYTHON_BIN || 'python3',
  OPENROUTER_API_KEY: '',
  TAVILY_API_KEY: ''
});

async function register(email, company) {
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest' },
    body: JSON.stringify({ email, password: accountPassword, company_name: company, sector: 'Servizi' })
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).success, true);
  const setCookie = response.headers.get('set-cookie');
  assert.ok(setCookie?.startsWith('token='));
  return setCookie.split(';')[0];
}

test('release HTTP journey keeps tenant data private and fails transparently without AI configuration', { timeout: 20_000 }, async (t) => {
  const { startServer } = require('../server');
  const server = await startServer();
  if (!server.listening) await once(server, 'listening');
  t.after(async () => {
    require('../app/services/scheduleService').stop();
    require('../app/services/dataRetention').stop();
    await require('../app/services/agentOrchestrator').shutdown(2_000);
    if (server.listening) await new Promise((resolve) => server.close(resolve));
    try { fs.unlinkSync(dbFile); } catch {}
    try { fs.rmSync(workspaceRoot, { recursive: true, force: true }); } catch {}
  });

  const health = await (await fetch(`${baseUrl}/api/health`)).json();
  assert.equal(health.status, 'ok');
  assert.deepEqual(health.checks, { database: 'ready', python: 'ready' });

  const ownerCookie = await register('owner@example.test', 'Owner Company');
  const dashboard = await fetch(`${baseUrl}/dashboard`, { headers: { Cookie: ownerCookie } });
  assert.equal(dashboard.status, 200);
  assert.match(await dashboard.text(), /Owner Company/);

  const skillResponse = await fetch(`${baseUrl}/api/skills`, {
    method: 'POST',
    headers: { Cookie: ownerCookie, Origin: baseUrl, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'E2E Data Auditor', category: 'data', description: 'Verifica il brief allegato.',
      instructions: 'Controlla struttura, dati mancanti e limiti. Consegna evidenze e raccomandazioni separate.'
    })
  });
  assert.equal(skillResponse.status, 201);
  const skill = (await skillResponse.json()).skill;
  assert.equal(skill.version, 1);
  const skillsStudio = await fetch(`${baseUrl}/workspace/skills`, { headers: { Cookie: ownerCookie } });
  assert.equal(skillsStudio.status, 200);
  assert.match(await skillsStudio.text(), /E2E Data Auditor/);

  const leadResponse = await fetch(`${baseUrl}/api/leads`, {
    method: 'POST',
    headers: { Cookie: ownerCookie, Origin: baseUrl, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Mario Rossi', email: 'mario@example.test', phone: '+39 333 444 5566', source: 'e2e' })
  });
  assert.equal(leadResponse.status, 201);
  const leadId = (await leadResponse.json()).id;

  const form = new FormData();
  form.append('prompt', 'Analizza con Python il documento allegato e prepara un report Markdown verificabile.');
  form.append('skill_ids', JSON.stringify([skill.id]));
  const fixture = Buffer.from([
    '# Brief operativo E2E',
    '',
    'Obiettivo: verificare analisi Python, isolamento tenant e consegna degli artefatti.',
    'Valore campione: 42.'
  ].join('\n'), 'utf8');
  form.append('files', new Blob([fixture], { type: 'text/markdown' }), 'brief-operativo.md');
  const taskResponse = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST', headers: { Cookie: ownerCookie, Origin: baseUrl }, body: form
  });
  assert.equal(taskResponse.status, 201);
  const taskId = (await taskResponse.json()).id;

  let state;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    state = await (await fetch(`${baseUrl}/api/tasks/${taskId}/state`, { headers: { Cookie: ownerCookie } })).json();
    if (['waiting_configuration', 'completed', 'failed', 'stopped', 'waiting_approval'].includes(state.task.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(state.task.status, 'waiting_configuration');
  assert.equal(state.task.mode, 'autonomous');
  assert.match(state.task.error, /OPENROUTER_API_KEY/);
  assert.ok(state.events.some((event) => event.type === 'python_analyze' && event.status === 'completed'));
  const taskPage = await fetch(`${baseUrl}/workspace/task/${taskId}`, { headers: { Cookie: ownerCookie } });
  assert.equal(taskPage.status, 200);
  assert.match(await taskPage.text(), /E2E Data Auditor/);

  const teamForm = new FormData();
  teamForm.append('prompt', 'Attiva un team di specialisti per confrontare rischi e opportunità del lancio commerciale.');
  teamForm.append('mode', 'team');
  const teamResponse = await fetch(`${baseUrl}/api/tasks`, {
    method: 'POST', headers: { Cookie: ownerCookie, Origin: baseUrl }, body: teamForm
  });
  assert.equal(teamResponse.status, 201);
  const teamTaskId = (await teamResponse.json()).id;
  let teamState;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    teamState = await (await fetch(`${baseUrl}/api/tasks/${teamTaskId}/state`, { headers: { Cookie: ownerCookie } })).json();
    if (['waiting_configuration', 'completed', 'failed', 'stopped'].includes(teamState.task.status)) break;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert.equal(teamState.task.mode, 'team');
  assert.equal(teamState.task.status, 'waiting_configuration');
  assert.match(teamState.task.error, /OPENROUTER_API_KEY/);
  assert.ok(teamState.events.some((event) => event.type === 'team_research' && event.status === 'waiting'));

  const accountExport = await (await fetch(`${baseUrl}/api/account/export`, { headers: { Cookie: ownerCookie } })).json();
  assert.equal(accountExport.account.email, 'owner@example.test');
  assert.ok(accountExport.crm.leads.some((lead) => lead.id === leadId));
  assert.ok(accountExport.workspace.tasks.some((task) => task.id === taskId));
  assert.ok(accountExport.workspace.skills.some((item) => item.id === skill.id));
  assert.ok(accountExport.workspace.task_skills.some((item) => item.task_id === taskId && item.skill_id === skill.id));
  assert.equal(Object.hasOwn(accountExport.account, 'password'), false);

  const blockedOrigin = await fetch(`${baseUrl}/api/projects`, {
    method: 'POST',
    headers: { Cookie: ownerCookie, Origin: 'https://attacker.example', 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'Blocked project' })
  });
  assert.equal(blockedOrigin.status, 403);

  const otherCookie = await register('other@example.test', 'Other Company');
  const privateSkill = await fetch(`${baseUrl}/api/skills/${skill.id}`, { headers: { Cookie: otherCookie } });
  assert.equal(privateSkill.status, 404);
  const privateLead = await fetch(`${baseUrl}/dashboard/lead/${leadId}`, { headers: { Cookie: otherCookie } });
  assert.equal(privateLead.status, 404);
});
