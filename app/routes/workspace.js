const express = require('express');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const appConfig = require('../config/app');
const fileStore = require('../services/fileStore');
const orchestrator = require('../services/agentOrchestrator');
const secretVault = require('../services/secretVault');
const scheduleService = require('../services/scheduleService');
const { renderMarkdown } = require('../services/markdown');
const emailService = require('../services/email');
const whatsappService = require('../services/whatsapp');

const router = express.Router();
router.use(authenticate);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: fileStore.maxFileBytes, files: 5, fields: 20 },
  fileFilter: (req, file, callback) => callback(null, true)
});

function sameOrigin(req, res, next) {
  if (req.method === 'GET' || req.headers.authorization?.startsWith('Bearer ')) return next();
  const source = req.get('origin') || req.get('referer');
  if (!source) return next();
  try {
    const expected = new URL(process.env.APP_URL || `${req.protocol}://${req.get('host')}`).origin;
    if (new URL(source).origin !== expected) return res.status(403).json({ error: 'Origine richiesta non valida' });
  } catch { return res.status(403).json({ error: 'Origine richiesta non valida' }); }
  next();
}
router.use(sameOrigin);

function ownedProject(db, projectId, userId) {
  if (!projectId) return null;
  return db.prepare('SELECT * FROM projects WHERE id = ? AND user_id = ? AND archived = 0').get(projectId, userId);
}

function enforceTaskQuota(db, userId) {
  const error = scheduleService.taskQuotaError(db, userId);
  if (!error) return null;
  const user = db.prepare('SELECT plan FROM users WHERE id = ?').get(userId) || { plan: 'starter' };
  return `${error} Piano ${appConfig.plans[user.plan]?.name || 'Starter'}.`;
}

router.get('/workspace', (req, res) => {
  const db = getDatabase();
  const tasks = db.prepare(`SELECT t.*, p.name AS project_name FROM agent_tasks t LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.user_id = ? ORDER BY t.created_at DESC LIMIT 30`).all(req.user.id);
  const projects = db.prepare('SELECT * FROM projects WHERE user_id = ? AND archived = 0 ORDER BY updated_at DESC').all(req.user.id);
  const schedules = db.prepare('SELECT * FROM task_schedules WHERE user_id = ? ORDER BY created_at DESC LIMIT 20').all(req.user.id);
  const counts = {
    total: db.prepare('SELECT COUNT(*) as count FROM agent_tasks WHERE user_id = ?').get(req.user.id).count,
    running: db.prepare("SELECT COUNT(*) as count FROM agent_tasks WHERE user_id = ? AND status IN ('planning','running','waiting_approval')").get(req.user.id).count,
    done: db.prepare("SELECT COUNT(*) as count FROM agent_tasks WHERE user_id = ? AND status = 'completed'").get(req.user.id).count
  };
  res.render('dashboard/workspace', { title: 'WES Workspace', page: 'workspace', tasks, projects, schedules, counts });
});

router.get('/workspace/task/:id', (req, res) => {
  const db = getDatabase();
  const task = db.prepare(`SELECT t.*, p.name AS project_name FROM agent_tasks t LEFT JOIN projects p ON p.id = t.project_id
    WHERE t.id = ? AND t.user_id = ?`).get(req.params.id, req.user.id);
  if (!task) return res.status(404).render('public/404', { title: 'Task non trovato' });
  const events = db.prepare('SELECT * FROM task_events WHERE task_id = ? ORDER BY created_at ASC').all(task.id);
  const artifacts = db.prepare('SELECT id, name, type, created_at FROM task_artifacts WHERE task_id = ? ORDER BY created_at DESC').all(task.id);
  const approvals = db.prepare('SELECT id, action_type, title, description, payload, status, created_at FROM task_approvals WHERE task_id = ? AND user_id = ? ORDER BY created_at DESC').all(task.id, req.user.id);
  for (const approval of approvals) {
    try {
      const payload = JSON.parse(approval.payload || '{}');
      approval.details = Object.fromEntries(Object.entries(payload).filter(([key]) => !key.startsWith('_')));
    } catch { approval.details = {}; }
    delete approval.payload;
  }
  const files = db.prepare('SELECT id, original_name, mime_type, size_bytes, created_at FROM workspace_files WHERE task_id = ? AND user_id = ? ORDER BY created_at ASC').all(task.id, req.user.id);
  let parsedPlan = [];
  try { parsedPlan = JSON.parse(task.plan || '[]'); } catch {}
  res.render('dashboard/task', { title: task.title, page: 'workspace', task, events, artifacts, approvals, files, parsedPlan, resultHtml: renderMarkdown(task.result) });
});

router.post('/api/tasks', upload.array('files', 5), (req, res, next) => {
  const db = getDatabase();
  const prompt = orchestrator.cleanText(req.body.prompt, 8000);
  const projectId = orchestrator.cleanText(req.body.project_id, 80) || null;
  const mode = req.body.mode === 'team' ? 'team' : 'autonomous';
  if (prompt.length < 10) return res.status(422).json({ success: false, error: 'Descrivi meglio il risultato che vuoi ottenere.' });
  if (projectId && !ownedProject(db, projectId, req.user.id)) return res.status(404).json({ success: false, error: 'Progetto non trovato.' });
  try { (req.files || []).forEach(fileStore.validateUpload); } catch (error) { return res.status(422).json({ success: false, error: error.message }); }
  const quotaError = enforceTaskQuota(db, req.user.id);
  if (quotaError) return res.status(429).json({ success: false, error: quotaError });
  const id = uuidv4();
  const title = orchestrator.cleanText(prompt.split(/[.!?\n]/)[0], 72) || 'Nuovo task WES';
  const storedPaths = [];
  try {
    db.prepare('INSERT INTO agent_tasks (id, user_id, project_id, title, prompt, status, progress, mode, plan) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, req.user.id, projectId, title, prompt, 'planning', 1, mode, '[]');
    for (const file of req.files || []) {
      const stored = fileStore.saveUpload({ userId: req.user.id, taskId: id, file });
      storedPaths.push(stored.storagePath);
      db.prepare(`INSERT INTO workspace_files (id, user_id, project_id, task_id, original_name, stored_name, mime_type, size_bytes, storage_path, sha256)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(uuidv4(), req.user.id, projectId, id, orchestrator.cleanText(file.originalname, 240), stored.storedName, file.mimetype, file.size, stored.storagePath, stored.sha256);
    }
    orchestrator.startTask(id);
    return res.status(201).json({ success: true, id, redirect: `/workspace/task/${id}` });
  } catch (error) {
    storedPaths.forEach((storagePath) => { try { fileStore.removeFile(storagePath); } catch {} });
    try { db.prepare('DELETE FROM agent_tasks WHERE id = ? AND user_id = ?').run(id, req.user.id); } catch {}
    next(error);
  }
});

router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === 'LIMIT_FILE_SIZE' ? 'Un file supera il limite consentito.' : 'Allegati non validi.';
    return res.status(422).json({ success: false, error: message });
  }
  next(error);
});

router.get('/api/tasks/:id/state', (req, res) => {
  const db = getDatabase();
  const task = db.prepare('SELECT id, title, status, progress, current_step, mode, error, result, needs_approval, updated_at FROM agent_tasks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task non trovato' });
  const events = db.prepare('SELECT id, type, title, detail, status, created_at FROM task_events WHERE task_id = ? ORDER BY created_at ASC').all(task.id);
  const artifacts = db.prepare('SELECT id, name, type, created_at FROM task_artifacts WHERE task_id = ? ORDER BY created_at DESC').all(task.id);
  const approvals = db.prepare('SELECT id, action_type, title, description, status, created_at FROM task_approvals WHERE task_id = ? AND user_id = ? ORDER BY created_at DESC').all(task.id, req.user.id);
  res.json({ task, events, artifacts, approvals });
});

router.post('/api/tasks/:id/stop', (req, res) => {
  const task = getDatabase().prepare('SELECT id FROM agent_tasks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task non trovato' });
  orchestrator.stopTask(task.id, req.user.id);
  res.json({ success: true });
});

router.post('/api/tasks/:id/retry', (req, res) => {
  const db = getDatabase();
  const task = db.prepare('SELECT * FROM agent_tasks WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!task) return res.status(404).json({ error: 'Task non trovato' });
  if (!['failed', 'waiting_configuration', 'stopped'].includes(task.status)) return res.status(409).json({ error: 'Questo task non può essere riavviato ora.' });
  db.prepare("UPDATE agent_tasks SET status = 'running', error = NULL, cancel_requested = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?").run(task.id, req.user.id);
  orchestrator.startTask(task.id);
  res.json({ success: true });
});

router.post('/api/approvals/:id', (req, res) => {
  const db = getDatabase();
  const decision = req.body.decision;
  if (!['approved', 'rejected'].includes(decision)) return res.status(422).json({ error: 'Decisione non valida' });
  const approval = db.prepare('SELECT * FROM task_approvals WHERE id = ? AND user_id = ? AND status = ?').get(req.params.id, req.user.id, 'pending');
  if (!approval) return res.status(404).json({ error: 'Approvazione non trovata' });
  db.prepare('UPDATE task_approvals SET status = ?, decided_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(decision, approval.id, req.user.id);
  if (decision === 'rejected') {
    db.prepare("UPDATE agent_tasks SET status = 'stopped', needs_approval = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?").run(approval.task_id, req.user.id);
  } else {
    let resumeSameStep = false;
    try { resumeSameStep = Boolean(JSON.parse(approval.payload || '{}')._resume_same_step); } catch {}
    db.prepare(`UPDATE agent_tasks SET status = 'running', needs_approval = 0,
      current_step = current_step + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?`)
      .run(resumeSameStep ? 0 : 1, approval.task_id, req.user.id);
    orchestrator.startTask(approval.task_id);
  }
  db.prepare('INSERT INTO task_events (id, task_id, type, title, detail, status) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), approval.task_id, 'approval', decision === 'approved' ? 'Azione approvata' : 'Azione rifiutata', approval.title, 'completed');
  res.json({ success: true, decision });
});

router.get('/api/artifacts/:id/download', (req, res) => {
  const artifact = getDatabase().prepare(`SELECT a.*, t.user_id AS owner_id FROM task_artifacts a JOIN agent_tasks t ON t.id = a.task_id
    WHERE a.id = ? AND t.user_id = ?`).get(req.params.id, req.user.id);
  if (!artifact) return res.status(404).json({ error: 'File non trovato' });
  const filename = String(artifact.name || 'output.txt').replace(/[\r\n"\\/]/g, '_');
  res.setHeader('Content-Type', artifact.type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (artifact.url) {
    const safePath = fileStore.ensureInsideTask(req.user.id, artifact.task_id, artifact.url);
    return res.send(fileStore.readFile(safePath));
  }
  return res.send(artifact.content || '');
});

router.get('/api/workspace-files/:id/download', (req, res) => {
  const file = getDatabase().prepare('SELECT * FROM workspace_files WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!file) return res.status(404).json({ error: 'File non trovato' });
  const filename = String(file.original_name).replace(/[\r\n"\\/]/g, '_');
  res.setHeader('Content-Type', file.mime_type || 'application/octet-stream');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  const safePath = fileStore.ensureInsideTask(req.user.id, file.task_id, file.storage_path);
  res.send(fileStore.readFile(safePath));
});

router.post('/api/projects', (req, res) => {
  const db = getDatabase();
  const name = orchestrator.cleanText(req.body.name, 80);
  const description = orchestrator.cleanText(req.body.description, 500);
  const instructions = orchestrator.cleanText(req.body.instructions, 5000);
  if (name.length < 2) return res.status(422).json({ error: 'Inserisci un nome per il progetto.' });
  const count = Number(db.prepare('SELECT COUNT(*) AS count FROM projects WHERE user_id = ? AND archived = 0').get(req.user.id).count);
  if (count >= 50) return res.status(429).json({ error: 'Limite di 50 progetti raggiunto.' });
  const id = uuidv4();
  db.prepare('INSERT INTO projects (id, user_id, name, description, instructions) VALUES (?, ?, ?, ?, ?)').run(id, req.user.id, name, description, instructions);
  res.status(201).json({ success: true, project: { id, name, description, instructions } });
});

router.post('/api/agent-connectors/:service', (req, res) => {
  const service = req.params.service;
  if (!['openrouter', 'tavily'].includes(service)) return res.status(404).json({ error: 'Connettore non supportato' });
  const apiKey = String(req.body.api_key || '').trim();
  const valid = service === 'openrouter' ? /^sk-or-(?:v1-)?[A-Za-z0-9_-]{20,}$/.test(apiKey) : /^tvly-[A-Za-z0-9_-]{20,}$/.test(apiKey);
  if (!valid) return res.status(422).json({ error: 'Formato chiave API non valido.' });
  let nextSettings = null;
  if (service === 'openrouter' && req.body.model) {
    const model = String(req.body.model).trim();
    if (!/^[A-Za-z0-9@~._:-]+\/[A-Za-z0-9@~._:+-]+$/.test(model) || model.length > 150) return res.status(422).json({ error: 'ID modello OpenRouter non valido.' });
    const db = getDatabase();
    const record = db.prepare('SELECT settings FROM users WHERE id = ?').get(req.user.id);
    let settings = {};
    try { settings = JSON.parse(record?.settings || '{}'); } catch {}
    settings.agent_model = model;
    nextSettings = JSON.stringify(settings);
  }
  secretVault.setSecret(req.user.id, service, apiKey);
  if (nextSettings) getDatabase().prepare('UPDATE users SET settings = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(nextSettings, req.user.id);
  res.json({ success: true });
});

router.delete('/api/agent-connectors/:service', (req, res) => {
  if (!['openrouter', 'tavily'].includes(req.params.service)) return res.status(404).json({ error: 'Connettore non supportato' });
  secretVault.removeSecret(req.user.id, req.params.service);
  res.json({ success: true });
});

function markIntegration(db, userId, service, connected, credentials = {}) {
  db.prepare(`INSERT INTO integrations (id, user_id, service, is_connected, credentials, updated_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id, service) DO UPDATE SET is_connected = excluded.is_connected, credentials = excluded.credentials, updated_at = CURRENT_TIMESTAMP`)
    .run(uuidv4(), userId, service, connected ? 1 : 0, JSON.stringify(credentials));
}

router.post('/api/integrations/email', async (req, res) => {
  const creds = {
    host: orchestrator.cleanText(req.body.host, 253).toLowerCase(),
    port: Number(req.body.port || 587),
    user: orchestrator.cleanText(req.body.user, 254),
    pass: String(req.body.pass || '').slice(0, 500),
    from: orchestrator.cleanText(req.body.from || req.body.user, 254)
  };
  if (!creds.host || !creds.user || creds.pass.length < 4 || ![465, 587].includes(creds.port) || !/^\S+@\S+\.\S+$/.test(creds.from)) {
    return res.status(422).json({ error: 'Configurazione SMTP non valida.' });
  }
  try {
    await emailService.verifyCredentials(creds);
  } catch {
    return res.status(422).json({ error: 'Il server SMTP non ha accettato la configurazione.' });
  }
  secretVault.setSecret(req.user.id, 'email', JSON.stringify(creds));
  markIntegration(getDatabase(), req.user.id, 'email', true, { host: creds.host, port: creds.port, from: creds.from });
  res.json({ success: true });
});

router.post('/api/integrations/whatsapp', async (req, res) => {
  const token = String(req.body.token || '').trim();
  const phoneId = String(req.body.phone_id || '').trim();
  if (!/^[A-Za-z0-9_-]{40,500}$/.test(token) || !/^\d{5,30}$/.test(phoneId)) {
    return res.status(422).json({ error: 'Token o Phone Number ID non validi.' });
  }
  let verified;
  try {
    verified = await whatsappService.verifyConfig(token, phoneId);
  } catch {
    return res.status(422).json({ error: 'Meta non ha convalidato token e Phone Number ID.' });
  }
  secretVault.setSecret(req.user.id, 'whatsapp', token);
  secretVault.setSecret(req.user.id, 'whatsapp_phone_id', phoneId);
  markIntegration(getDatabase(), req.user.id, 'whatsapp', true, verified);
  res.json({ success: true, verified });
});

router.delete('/api/integrations/:service', (req, res) => {
  const service = req.params.service;
  if (!['email', 'whatsapp'].includes(service)) return res.status(404).json({ error: 'Integrazione non supportata' });
  secretVault.removeSecret(req.user.id, service);
  if (service === 'whatsapp') secretVault.removeSecret(req.user.id, 'whatsapp_phone_id');
  markIntegration(getDatabase(), req.user.id, service, false);
  res.json({ success: true });
});

router.post('/api/schedules', (req, res) => {
  const db = getDatabase();
  const name = orchestrator.cleanText(req.body.name, 80);
  const prompt = orchestrator.cleanText(req.body.prompt, 8000);
  const frequency = req.body.frequency;
  const mode = req.body.mode === 'team' ? 'team' : 'autonomous';
  const projectId = orchestrator.cleanText(req.body.project_id, 80) || null;
  const hour = Number(req.body.hour);
  const minute = Number(req.body.minute || 0);
  const weekday = Number(req.body.weekday || 1);
  const timezone = ['Europe/Rome', 'Europe/London', 'America/New_York', 'Asia/Dubai'].includes(req.body.timezone) ? req.body.timezone : 'Europe/Rome';
  if (name.length < 2 || prompt.length < 10) return res.status(422).json({ error: 'Nome e obiettivo della pianificazione sono obbligatori.' });
  if (projectId && !ownedProject(db, projectId, req.user.id)) return res.status(404).json({ error: 'Progetto non trovato.' });
  if (!Number.isInteger(hour) || hour < 0 || hour > 23 || !Number.isInteger(minute) || minute < 0 || minute > 59) return res.status(422).json({ error: 'Orario non valido.' });
  let cronExpression;
  if (frequency === 'daily') cronExpression = `${minute} ${hour} * * *`;
  else if (frequency === 'weekdays') cronExpression = `${minute} ${hour} * * 1-5`;
  else if (frequency === 'weekly' && Number.isInteger(weekday) && weekday >= 0 && weekday <= 6) cronExpression = `${minute} ${hour} * * ${weekday}`;
  else return res.status(422).json({ error: 'Frequenza non valida.' });
  const user = db.prepare('SELECT plan FROM users WHERE id = ?').get(req.user.id) || { plan: 'starter' };
  const limits = { starter: 3, pro: 20, enterprise: 100 };
  const count = Number(db.prepare('SELECT COUNT(*) AS count FROM task_schedules WHERE user_id = ? AND is_active = 1').get(req.user.id).count);
  if (count >= (limits[user.plan] || 3)) return res.status(429).json({ error: 'Limite pianificazioni attive raggiunto.' });
  const next = scheduleService.nextRun(cronExpression, timezone);
  const id = uuidv4();
  db.prepare(`INSERT INTO task_schedules (id, user_id, project_id, name, prompt, mode, cron_expression, timezone, next_run)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, req.user.id, projectId, name, prompt, mode, cronExpression, timezone, next?.toISOString() || null);
  res.status(201).json({ success: true, id, next_run: next?.toISOString() });
});

router.post('/api/schedules/:id/toggle', (req, res) => {
  const db = getDatabase();
  const schedule = db.prepare('SELECT * FROM task_schedules WHERE id = ? AND user_id = ?').get(req.params.id, req.user.id);
  if (!schedule) return res.status(404).json({ error: 'Pianificazione non trovata.' });
  const active = Number(schedule.is_active) ? 0 : 1;
  const next = active ? scheduleService.nextRun(schedule.cron_expression, schedule.timezone) : null;
  db.prepare('UPDATE task_schedules SET is_active = ?, next_run = ? WHERE id = ? AND user_id = ?').run(active, next?.toISOString() || null, schedule.id, req.user.id);
  res.json({ success: true, active: Boolean(active) });
});

module.exports = router;
