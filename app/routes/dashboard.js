/**
 * Dashboard Routes (protected)
 */
const express = require('express');
const router = express.Router();
const { getDatabase } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const appConfig = require('../config/app');
const secretVault = require('../services/secretVault');
const { normalizePhone, validPhone } = require('../utils/contact');
const accountExportTimes = new Map();

const clean = (value, max = 500) => String(value || '').replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, max);
const validId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 100;

// All dashboard routes require authentication
router.use(authenticate);

// Dashboard home
router.get('/dashboard', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  
  // Gather stats
  const stats = {
    leads: db.prepare('SELECT COUNT(*) as count FROM leads WHERE user_id = ?').get(userId),
    newLeads: db.prepare("SELECT COUNT(*) as count FROM leads WHERE user_id = ? AND status = 'new'").get(userId),
    qualifiedLeads: db.prepare("SELECT COUNT(*) as count FROM leads WHERE user_id = ? AND status = 'qualified'").get(userId),
    conversations: db.prepare("SELECT COUNT(*) as count FROM conversations WHERE user_id = ? AND status = 'active'").get(userId),
    appointments: db.prepare("SELECT COUNT(*) as count FROM appointments WHERE user_id = ? AND status = 'scheduled'").get(userId),
    followUps: db.prepare("SELECT COUNT(*) as count FROM follow_ups WHERE user_id = ? AND status = 'pending'").get(userId),
    automations: db.prepare("SELECT COUNT(*) as count FROM automations WHERE user_id = ? AND is_active = 1").get(userId)
  };
  
  // Recent leads
  const recentLeads = db.prepare(`
    SELECT * FROM leads WHERE user_id = ? ORDER BY created_at DESC LIMIT 5
  `).all(userId);
  
  // Recent conversations
  const recentConversations = db.prepare(`
    SELECT c.*, l.name as lead_name, l.email as lead_email 
    FROM conversations c
    LEFT JOIN leads l ON l.id = c.lead_id
    WHERE c.user_id = ? ORDER BY c.updated_at DESC LIMIT 5
  `).all(userId);
  
  // Usage stats for chart
  const usageStats = db.prepare(`
    SELECT * FROM usage_stats WHERE user_id = ? ORDER BY date DESC LIMIT 7
  `).all(userId);
  
  const user = db.prepare('SELECT id, email, company_name, sector, phone, role, plan, status, created_at, last_login FROM users WHERE id = ?').get(userId);
  const plan = appConfig.plans[user.plan] || appConfig.plans.starter;
  
  res.render('dashboard/index', {
    title: 'Dashboard - WES AI Automation',
    stats,
    recentLeads,
    recentConversations,
    usageStats: usageStats.reverse(),
    user,
    plan,
    page: 'dashboard'
  });
});

// Leads page
router.get('/dashboard/lead', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  
  const status = ['new', 'qualified', 'contacted', 'converted', 'lost'].includes(req.query.status) ? req.query.status : '';
  let leads;
  
  if (status) {
    leads = db.prepare('SELECT * FROM leads WHERE user_id = ? AND status = ? ORDER BY created_at DESC').all(userId, status);
  } else {
    leads = db.prepare('SELECT * FROM leads WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  }
  
  const stats = {
    all: db.prepare('SELECT COUNT(*) as count FROM leads WHERE user_id = ?').get(userId),
    new: db.prepare("SELECT COUNT(*) as count FROM leads WHERE user_id = ? AND status = 'new'").get(userId),
    qualified: db.prepare("SELECT COUNT(*) as count FROM leads WHERE user_id = ? AND status = 'qualified'").get(userId),
    contacted: db.prepare("SELECT COUNT(*) as count FROM leads WHERE user_id = ? AND status = 'contacted'").get(userId),
    converted: db.prepare("SELECT COUNT(*) as count FROM leads WHERE user_id = ? AND status = 'converted'").get(userId),
    lost: db.prepare("SELECT COUNT(*) as count FROM leads WHERE user_id = ? AND status = 'lost'").get(userId),
  };
  
  res.render('dashboard/leads', {
    title: 'Lead - WES AI Automation',
    leads,
    stats,
    currentStatus: status,
    page: 'leads'
  });
});

router.get('/dashboard/lead/:id', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const lead = db.prepare('SELECT * FROM leads WHERE id = ? AND user_id = ?').get(req.params.id, userId);
  if (!lead) return res.status(404).render('public/404', { title: 'Lead non trovato - WES', message: 'Il lead non esiste oppure appartiene a un altro workspace.' });
  const conversations = db.prepare('SELECT id, channel, status, summary, sentiment, messages, updated_at FROM conversations WHERE lead_id = ? AND user_id = ? ORDER BY updated_at DESC LIMIT 10').all(lead.id, userId);
  for (const conversation of conversations) {
    try { conversation.messageCount = JSON.parse(conversation.messages || '[]').length; } catch { conversation.messageCount = 0; }
    delete conversation.messages;
  }
  const appointments = db.prepare('SELECT id, title, start_time, end_time, status FROM appointments WHERE lead_id = ? AND user_id = ? ORDER BY start_time DESC LIMIT 20').all(lead.id, userId);
  const followUps = db.prepare('SELECT id, type, channel, scheduled_at, executed_at, status FROM follow_ups WHERE lead_id = ? AND user_id = ? ORDER BY scheduled_at DESC LIMIT 20').all(lead.id, userId);
  const invoices = db.prepare('SELECT id, invoice_number, amount, status, created_at FROM invoices WHERE lead_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT 20').all(lead.id, userId);
  return res.render('dashboard/lead-detail', {
    title: `${lead.name || lead.email || 'Lead'} - WES AI Automation`, lead, conversations, appointments, followUps, invoices, page: 'leads'
  });
});

// Conversations
router.get('/dashboard/conversazioni', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  
  const conversations = db.prepare(`
    SELECT c.*, l.name as lead_name, l.email as lead_email, l.phone as lead_phone
    FROM conversations c
    LEFT JOIN leads l ON l.id = c.lead_id
    WHERE c.user_id = ?
    ORDER BY c.updated_at DESC
  `).all(userId);
  for (const conversation of conversations) {
    try { conversation.messageList = JSON.parse(conversation.messages || '[]'); } catch { conversation.messageList = []; }
  }
  const selectedConversation = conversations.find((conversation) => conversation.id === req.query.id) || conversations[0] || null;
  
  res.render('dashboard/conversations', {
    title: 'Conversazioni - WES AI Automation',
    conversations,
    selectedConversation,
    page: 'conversations'
  });
});

// Appointments
router.get('/dashboard/appuntamenti', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  
  const appointments = db.prepare(`
    SELECT a.*, l.name as lead_name, l.email as lead_email, l.phone as lead_phone
    FROM appointments a
    LEFT JOIN leads l ON l.id = a.lead_id
    WHERE a.user_id = ?
    ORDER BY a.start_time ASC
  `).all(userId);
  const leads = db.prepare('SELECT id, name, email, phone FROM leads WHERE user_id = ? ORDER BY name ASC LIMIT 500').all(userId);
  
  res.render('dashboard/appointments', {
    title: 'Appuntamenti - WES AI Automation',
    appointments,
    leads,
    page: 'appointments'
  });
});

// Follow-ups
router.get('/dashboard/follow-up', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  
  const followUps = db.prepare(`
    SELECT f.*, l.name as lead_name, l.email as lead_email
    FROM follow_ups f
    LEFT JOIN leads l ON l.id = f.lead_id
    WHERE f.user_id = ?
    ORDER BY f.scheduled_at DESC
  `).all(userId);
  
  res.render('dashboard/followup', {
    title: 'Follow-up - WES AI Automation',
    followUps,
    page: 'followup'
  });
});

// Preventivi
router.get('/dashboard/preventivi', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  
  const invoices = db.prepare(`
    SELECT i.*, l.name as lead_name
    FROM invoices i
    LEFT JOIN leads l ON l.id = i.lead_id
    WHERE i.user_id = ?
    ORDER BY i.created_at DESC
  `).all(userId);
  const leads = db.prepare('SELECT id, name, email, phone FROM leads WHERE user_id = ? ORDER BY name ASC, created_at DESC LIMIT 500').all(userId);
  
  res.render('dashboard/preventivi', {
    title: 'Preventivi - WES AI Automation',
    invoices,
    leads,
    page: 'preventivi'
  });
});

// Automations
router.get('/dashboard/automazioni', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  
  const automations = db.prepare('SELECT * FROM automations WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  
  res.render('dashboard/automations', {
    title: 'Automazioni - WES AI Automation',
    automations,
    templates: appConfig.automationTemplates,
    page: 'automations'
  });
});

// AI Agent Configuration
router.get('/dashboard/agente', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  
  const agent = db.prepare('SELECT * FROM agents WHERE user_id = ? AND is_active = 1').get(userId) || 
                db.prepare('SELECT * FROM agents WHERE user_id = ?').get(userId);
  const user = db.prepare('SELECT id, company_name, sector FROM users WHERE id = ?').get(userId);
  
  res.render('dashboard/agent-config', {
    title: 'Configura Agente AI - WES AI Automation',
    agent,
    user,
    page: 'agent'
  });
});

// Integrations
router.get('/dashboard/integrazioni', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  
  const integrations = db.prepare('SELECT * FROM integrations WHERE user_id = ?').all(userId);
  
  res.render('dashboard/integrations', {
    title: 'Integrazioni - WES AI Automation',
    integrations,
    agentConnectors: {
      openrouter: Boolean(process.env.OPENROUTER_API_KEY) || secretVault.hasSecret(userId, 'openrouter'),
      tavily: Boolean(process.env.TAVILY_API_KEY) || secretVault.hasSecret(userId, 'tavily')
    },
    channelConnectors: {
      whatsapp: integrations.some((integration) => integration.service === 'whatsapp' && Number(integration.is_connected) === 1),
      email: integrations.some((integration) => integration.service === 'email' && Number(integration.is_connected) === 1)
    },
    page: 'integrations'
  });
});

// Stats
router.get('/dashboard/statistiche', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  
  const usageStats = db.prepare(`
    SELECT * FROM usage_stats WHERE user_id = ? ORDER BY date DESC LIMIT 30
  `).all(userId).reverse();
  
  const totalStats = {
    totalLeads: db.prepare('SELECT COUNT(*) as count FROM leads WHERE user_id = ?').get(userId),
    totalConversations: db.prepare('SELECT COUNT(*) as count FROM conversations WHERE user_id = ?').get(userId),
    totalAppointments: db.prepare('SELECT COUNT(*) as count FROM appointments WHERE user_id = ?').get(userId),
    totalFollowUps: db.prepare('SELECT COUNT(*) as count FROM follow_ups WHERE user_id = ?').get(userId),
    conversionRate: 0
  };
  
  // Calculate conversion rate
  const totalLeads = totalStats.totalLeads.count;
  const convertedLeads = db.prepare("SELECT COUNT(*) as count FROM leads WHERE user_id = ? AND status = 'converted'").get(userId).count;
  totalStats.conversionRate = totalLeads > 0 ? Math.round((convertedLeads / totalLeads) * 100) : 0;
  const withPercentages = (rows) => rows.map((row) => ({
    key: row.key || 'sconosciuto',
    count: Number(row.count || 0),
    percentage: totalLeads > 0 ? Math.round((Number(row.count || 0) / totalLeads) * 100) : 0
  }));
  const sourceStats = withPercentages(db.prepare(`
    SELECT CASE WHEN source IS NULL OR trim(source) = '' THEN 'sconosciuto' ELSE lower(trim(source)) END AS key, COUNT(*) AS count
    FROM leads WHERE user_id = ? GROUP BY key ORDER BY count DESC, key ASC
  `).all(userId));
  const statusStats = withPercentages(db.prepare(`
    SELECT CASE WHEN status IS NULL OR trim(status) = '' THEN 'sconosciuto' ELSE lower(trim(status)) END AS key, COUNT(*) AS count
    FROM leads WHERE user_id = ? GROUP BY key ORDER BY count DESC, key ASC
  `).all(userId));
  
  res.render('dashboard/stats', {
    title: 'Statistiche - WES AI Automation',
    usageStats,
    totalStats,
    sourceStats,
    statusStats,
    page: 'stats'
  });
});

// Settings
router.get('/dashboard/impostazioni', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  
  const user = db.prepare('SELECT id, email, company_name, sector, phone, plan, settings FROM users WHERE id = ?').get(userId);
  let userSettings = {};
  try { userSettings = JSON.parse(user.settings || '{}'); } catch {}
  
  res.render('dashboard/settings', {
    title: 'Impostazioni - WES AI Automation',
    user,
    agentModel: userSettings.agent_model || process.env.OPENROUTER_MODEL || 'openrouter/auto',
    page: 'settings'
  });
});

// ============ API endpoints for dashboard ============

router.get('/api/account/export', (req, res) => {
  const now = Date.now();
  const lastExport = accountExportTimes.get(req.user.id) || 0;
  if (now - lastExport < 60_000) return res.status(429).json({ error: 'Attendi un minuto prima di generare un nuovo export.' });
  accountExportTimes.set(req.user.id, now);
  const db = getDatabase();
  const userId = req.user.id;
  const account = db.prepare(`SELECT id, email, company_name, sector, phone, role, plan, status, created_at, updated_at, last_login, settings
    FROM users WHERE id = ?`).get(userId);
  try { account.settings = JSON.parse(account.settings || '{}'); } catch { account.settings = {}; }
  const redactConnectorMetadata = (value) => {
    if (Array.isArray(value)) return value.map(redactConnectorMetadata);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !/(pass|token|secret|api.?key|credential)/i.test(key))
      .map(([key, item]) => [key, redactConnectorMetadata(item)]));
  };
  const integrationRows = db.prepare('SELECT service, is_connected, credentials, last_sync, created_at, updated_at FROM integrations WHERE user_id = ? ORDER BY created_at ASC').all(userId)
    .map((row) => {
      try { row.credentials = redactConnectorMetadata(JSON.parse(row.credentials || '{}')); } catch { row.credentials = {}; }
      return row;
    });
  const exported = {
    format: 'wes-account-export-v1',
    generated_at: new Date().toISOString(),
    account,
    connectors: {
      secrets: db.prepare('SELECT service, is_active, created_at FROM api_keys WHERE user_id = ? ORDER BY created_at ASC').all(userId),
      integrations: integrationRows
    },
    crm: {
      agents: db.prepare('SELECT id, name, tone, welcome_message, qualification_questions, transfer_conditions, is_active, created_at, updated_at FROM agents WHERE user_id = ?').all(userId),
      leads: db.prepare('SELECT id, name, email, phone, source, status, score, notes, custom_fields, created_at, updated_at, first_contact, last_contact FROM leads WHERE user_id = ? ORDER BY created_at ASC').all(userId),
      conversations: db.prepare('SELECT id, lead_id, agent_id, channel, status, messages, summary, sentiment, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY created_at ASC').all(userId),
      appointments: db.prepare('SELECT id, lead_id, title, description, start_time, end_time, status, created_at, updated_at FROM appointments WHERE user_id = ? ORDER BY created_at ASC').all(userId),
      follow_ups: db.prepare('SELECT id, lead_id, type, delay_hours, message_template, scheduled_at, executed_at, status, channel, created_at FROM follow_ups WHERE user_id = ? ORDER BY created_at ASC').all(userId),
      invoices: db.prepare('SELECT id, lead_id, invoice_number, amount, status, items, notes, sent_at, paid_at, created_at, updated_at FROM invoices WHERE user_id = ? ORDER BY created_at ASC').all(userId),
      automations: db.prepare('SELECT id, name, trigger_event, actions, conditions, is_active, last_run, created_at, updated_at FROM automations WHERE user_id = ? ORDER BY created_at ASC').all(userId)
    },
    workspace: {
      projects: db.prepare('SELECT id, name, description, instructions, color, archived, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY created_at ASC').all(userId),
      memories: db.prepare('SELECT id, project_id, kind, content, source_task_id, created_at FROM project_memories WHERE user_id = ? ORDER BY created_at ASC').all(userId),
      tasks: db.prepare('SELECT id, project_id, title, prompt, status, progress, current_step, mode, plan, result, error, needs_approval, credits_used, created_at, updated_at, completed_at FROM agent_tasks WHERE user_id = ? ORDER BY created_at ASC').all(userId),
      events: db.prepare(`SELECT e.id, e.task_id, e.type, e.title, e.detail, e.status, e.metadata, e.created_at FROM task_events e
        JOIN agent_tasks t ON t.id = e.task_id WHERE t.user_id = ? ORDER BY e.created_at ASC`).all(userId),
      artifacts: db.prepare(`SELECT a.id, a.task_id, a.name, a.type, a.content, a.created_at FROM task_artifacts a
        JOIN agent_tasks t ON t.id = a.task_id WHERE t.user_id = ? ORDER BY a.created_at ASC`).all(userId),
      files: db.prepare('SELECT id, project_id, task_id, original_name, mime_type, size_bytes, sha256, created_at FROM workspace_files WHERE user_id = ? ORDER BY created_at ASC').all(userId),
      approvals: db.prepare('SELECT id, task_id, action_type, title, description, payload, status, decided_at, created_at FROM task_approvals WHERE user_id = ? ORDER BY created_at ASC').all(userId),
      messages: db.prepare('SELECT id, task_id, role, content, created_at FROM task_messages WHERE user_id = ? ORDER BY created_at ASC').all(userId),
      schedules: db.prepare('SELECT id, project_id, name, prompt, mode, skill_ids, cron_expression, timezone, is_active, last_run, next_run, created_at FROM task_schedules WHERE user_id = ? ORDER BY created_at ASC').all(userId),
      skills: db.prepare('SELECT id, name, slug, description, instructions, category, source, version, checksum, is_active, created_at, updated_at FROM agent_skills WHERE user_id = ? ORDER BY created_at ASC').all(userId),
      skill_versions: db.prepare('SELECT skill_id, version, name, description, instructions, category, checksum, created_at FROM agent_skill_versions WHERE user_id = ? ORDER BY created_at ASC').all(userId),
      project_skills: db.prepare('SELECT project_id, skill_id, position, created_at FROM project_skill_bindings WHERE user_id = ? ORDER BY created_at ASC').all(userId),
      task_skills: db.prepare('SELECT task_id, skill_id, skill_version, name_snapshot, description_snapshot, instructions_snapshot, category_snapshot, checksum, position, created_at FROM task_skill_bindings WHERE user_id = ? ORDER BY created_at ASC').all(userId)
    },
    billing: db.prepare('SELECT plan, status, current_period_start, current_period_end, trial_end, cancelled_at, created_at, updated_at FROM subscriptions WHERE user_id = ?').all(userId),
    usage: db.prepare('SELECT date, conversations_count, leads_count, messages_count, follow_ups_sent, appointments_scheduled, api_calls FROM usage_stats WHERE user_id = ? ORDER BY date ASC').all(userId),
    audit_log: db.prepare('SELECT level, action, details, ip_address, user_agent, created_at FROM logs WHERE user_id = ? ORDER BY created_at ASC').all(userId)
  };
  const body = JSON.stringify(exported, null, 2);
  if (Buffer.byteLength(body) > 25 * 1024 * 1024) return res.status(413).json({ error: 'Export troppo grande per il download diretto. Contatta il titolare privacy per una consegna assistita.' });
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="wes-export-${new Date().toISOString().slice(0, 10)}.json"`);
  res.setHeader('Cache-Control', 'no-store');
  return res.send(body);
});

router.post('/api/leads', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const name = clean(req.body.name, 120);
  const email = clean(req.body.email, 254).toLowerCase();
  const phone = clean(req.body.phone, 40);
  const normalizedPhone = normalizePhone(phone);
  const source = clean(req.body.source || 'manual', 40).toLowerCase() || 'manual';
  const notes = clean(req.body.notes, 5000);
  if (!name && !email && !phone) return res.status(422).json({ error: 'Inserisci almeno nome, email o telefono.' });
  if (email && (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254)) return res.status(422).json({ error: 'Email non valida.' });
  if (phone && !validPhone(phone)) return res.status(422).json({ error: 'Telefono non valido.' });
  if ((email && db.prepare('SELECT id FROM leads WHERE user_id = ? AND lower(email) = ? LIMIT 1').get(userId, email)) ||
      (normalizedPhone && db.prepare('SELECT id FROM leads WHERE user_id = ? AND phone_normalized = ? LIMIT 1').get(userId, normalizedPhone))) {
    return res.status(409).json({ error: 'Esiste già un lead con questo contatto.' });
  }
  const id = uuidv4();
  db.prepare(`INSERT INTO leads (id, user_id, name, email, phone, phone_normalized, source, status, score, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'new', 0, ?)`).run(id, userId, name || null, email || null, phone || null, normalizedPhone || null, source, notes);
  db.prepare(`INSERT INTO logs (id, user_id, level, action, details) VALUES (?, ?, 'info', 'lead_created', ?)`)
    .run(uuidv4(), userId, JSON.stringify({ lead_id: id, source }));
  return res.status(201).json({ success: true, id, redirect: `/dashboard/lead/${id}` });
});

router.post('/api/leads/:id/update', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  if (!validId(req.params.id) || !db.prepare('SELECT id FROM leads WHERE id = ? AND user_id = ?').get(req.params.id, userId)) return res.status(404).json({ error: 'Lead non trovato.' });
  const name = clean(req.body.name, 120);
  const email = clean(req.body.email, 254).toLowerCase();
  const phone = clean(req.body.phone, 40);
  const normalizedPhone = normalizePhone(phone);
  const source = clean(req.body.source || 'manual', 40).toLowerCase() || 'manual';
  const notes = clean(req.body.notes, 5000);
  const status = clean(req.body.status, 20);
  const score = Number(req.body.score);
  if (!name && !email && !phone) return res.status(422).json({ error: 'Inserisci almeno nome, email o telefono.' });
  if (email && !/^\S+@\S+\.\S+$/.test(email)) return res.status(422).json({ error: 'Email non valida.' });
  if (phone && !validPhone(phone)) return res.status(422).json({ error: 'Telefono non valido.' });
  if (!['new', 'qualified', 'contacted', 'converted', 'lost'].includes(status) || !Number.isInteger(score) || score < 0 || score > 10) return res.status(422).json({ error: 'Stato o score non valido.' });
  const duplicate = db.prepare(`SELECT id FROM leads WHERE user_id = ? AND id <> ? AND
    ((? <> '' AND lower(email) = ?) OR (? <> '' AND phone_normalized = ?)) LIMIT 1`).get(userId, req.params.id, email, email, normalizedPhone, normalizedPhone);
  if (duplicate) return res.status(409).json({ error: 'Un altro lead usa già questo contatto.' });
  const result = db.prepare(`UPDATE leads SET name = ?, email = ?, phone = ?, phone_normalized = ?, source = ?, status = ?, score = ?, notes = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ? AND user_id = ?`).run(name || null, email || null, phone || null, normalizedPhone || null, source, status, score, notes, req.params.id, userId);
  if (!result.changes) return res.status(404).json({ error: 'Lead non trovato.' });
  db.prepare(`INSERT INTO logs (id, user_id, level, action, details) VALUES (?, ?, 'info', 'lead_updated', ?)`)
    .run(uuidv4(), userId, JSON.stringify({ lead_id: req.params.id, status, score }));
  return res.json({ success: true });
});

router.post('/api/appointments', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const title = clean(req.body.title, 160);
  const description = clean(req.body.description, 2000);
  const leadId = clean(req.body.lead_id, 100) || null;
  const start = new Date(req.body.start_time);
  const duration = Math.max(15, Math.min(Number(req.body.duration_minutes) || 30, 480));
  if (title.length < 2 || !Number.isFinite(start.getTime())) return res.status(422).json({ error: 'Titolo o data non validi' });
  if (start.getTime() < Date.now() + 60_000 || start.getTime() > Date.now() + 2 * 365 * 24 * 60 * 60 * 1000) {
    return res.status(422).json({ error: 'Scegli una data futura entro due anni' });
  }
  if (leadId && !db.prepare('SELECT id FROM leads WHERE id = ? AND user_id = ?').get(leadId, userId)) {
    return res.status(404).json({ error: 'Lead non trovato' });
  }
  const end = new Date(start.getTime() + duration * 60_000);
  const conflict = db.prepare(`
    SELECT id FROM appointments
    WHERE user_id = ? AND status = 'scheduled' AND start_time < ? AND end_time > ? LIMIT 1
  `).get(userId, end.toISOString(), start.toISOString());
  if (conflict) return res.status(409).json({ error: 'Esiste già un appuntamento in questo intervallo' });
  const id = uuidv4();
  db.prepare(`
    INSERT INTO appointments (id, user_id, lead_id, title, description, start_time, end_time, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled')
  `).run(id, userId, leadId, title, description, start.toISOString(), end.toISOString());
  db.prepare(`INSERT INTO logs (id, user_id, level, action, details) VALUES (?, ?, 'info', 'appointment_created', ?)`)
    .run(uuidv4(), userId, JSON.stringify({ appointment_id: id, lead_id: leadId, start_time: start.toISOString() }));
  return res.status(201).json({ success: true, id });
});

router.post('/api/appointments/:id/status', (req, res) => {
  const status = clean(req.body.status, 20);
  if (!validId(req.params.id) || !['scheduled', 'completed', 'cancelled'].includes(status)) {
    return res.status(422).json({ error: 'Stato appuntamento non valido' });
  }
  const db = getDatabase();
  const result = db.prepare('UPDATE appointments SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
    .run(status, req.params.id, req.user.id);
  if (!result.changes) return res.status(404).json({ error: 'Appuntamento non trovato' });
  db.prepare(`INSERT INTO logs (id, user_id, level, action, details) VALUES (?, ?, 'info', 'appointment_status_updated', ?)`)
    .run(uuidv4(), req.user.id, JSON.stringify({ appointment_id: req.params.id, status }));
  return res.json({ success: true });
});

router.post('/api/conversations/:id/messages', async (req, res) => {
  if (!validId(req.params.id)) return res.status(422).json({ error: 'Conversazione non valida' });
  const content = clean(req.body.content, 4096);
  if (!content) return res.status(422).json({ error: 'Scrivi un messaggio' });
  const db = getDatabase();
  const conversation = db.prepare(`
    SELECT c.id, c.channel, l.phone FROM conversations c
    LEFT JOIN leads l ON l.id = c.lead_id
    WHERE c.id = ? AND c.user_id = ? AND c.status = 'active'
  `).get(req.params.id, req.user.id);
  if (!conversation) return res.status(404).json({ error: 'Conversazione non trovata' });
  if (conversation.channel !== 'whatsapp') return res.status(422).json({ error: 'L’invio manuale è disponibile solo per WhatsApp collegato' });
  try {
    const result = await require('../services/whatsapp').sendMessage(req.user.id, conversation.phone, content);
    return res.json({ success: true, messageId: result.messageId });
  } catch (error) {
    return res.status(502).json({ error: `Esito dell’invio non verificabile. Controlla WhatsApp prima di riprovare. ${clean(error.message, 260)}` });
  }
});

// Update agent config
router.post('/api/agent/save', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const name = clean(req.body.name, 80);
  const welcomeMessage = clean(req.body.welcome_message, 1500);
  const tone = ['professionale', 'amichevole', 'formale', 'informale', 'entusiasta'].includes(req.body.tone) ? req.body.tone : 'professionale';
  const questions = Array.isArray(req.body.questions) ? req.body.questions.slice(0, 20).map((question) => ({
    question: clean(question?.question, 400),
    required: Boolean(question?.required)
  })).filter((question) => question.question) : [];
  const transfer = req.body.transfer_conditions && typeof req.body.transfer_conditions === 'object' ? req.body.transfer_conditions : {};
  const transferConditions = {
    min_score: Math.max(0, Math.min(Number(transfer.min_score) || 0, 10)),
    has_email: Boolean(transfer.has_email),
    has_phone: Boolean(transfer.has_phone),
    has_interest: Boolean(transfer.has_interest)
  };
  if (name.length < 2 || welcomeMessage.length < 2) return res.status(422).json({ error: 'Nome e messaggio dell’agente non sono validi.' });
  
  let agent = db.prepare('SELECT * FROM agents WHERE user_id = ?').get(userId);
  
  if (agent) {
    db.prepare(`
      UPDATE agents SET name = ?, tone = ?, welcome_message = ?, qualification_questions = ?, transfer_conditions = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, tone, welcomeMessage, JSON.stringify(questions), JSON.stringify(transferConditions), agent.id);
  } else {
    const agentId = uuidv4();
    agent = { id: agentId };
    db.prepare(`
      INSERT INTO agents (id, user_id, name, tone, welcome_message, qualification_questions, transfer_conditions)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(agentId, userId, name, tone, welcomeMessage, JSON.stringify(questions), JSON.stringify(transferConditions));
  }
  
  db.prepare(`
    INSERT INTO logs (id, user_id, level, action, details)
    VALUES (?, ?, 'info', 'agent_updated', ?)
  `).run(uuidv4(), userId, JSON.stringify({ agentId: agent.id }));
  
  res.json({ success: true, message: 'Agente configurato con successo!' });
});

// Toggle automation
router.post('/api/automation/toggle', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const { id, is_active } = req.body;
  if (!validId(id) || typeof is_active !== 'boolean') return res.status(422).json({ error: 'Richiesta non valida' });
  
  const result = db.prepare('UPDATE automations SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
    .run(is_active ? 1 : 0, id, userId);
  if (!result.changes) return res.status(404).json({ error: 'Automazione non trovata' });
  
  res.json({ success: true });
});

// Create automation from template
router.post('/api/automation/create', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const { template_id } = req.body;
  
  const template = appConfig.automationTemplates.find(t => t.id === template_id);
  if (!template) {
    return res.status(400).json({ error: 'Template non trovato' });
  }
  
  const existing = db.prepare('SELECT id FROM automations WHERE user_id = ? AND name = ?').get(userId, template.name);
  if (existing) {
    return res.json({ success: true, message: 'Automazione già esistente' });
  }
  
  const actionMap = {
    'auto-response': ['send_welcome'],
    'qualify-lead': ['ask_questions', 'score_lead'],
    'save-crm': ['save_crm'],
    'auto-appointment': ['schedule_appointment'],
    'followup-1day': ['send_followup'],
    'followup-3days': ['send_followup_3days'],
    'notify-sales': ['notify_sales_team'],
    'weekly-report': ['generate_report']
  };
  const triggerMap = {
    'auto-response': 'first_message',
    'qualify-lead': 'first_message',
    'save-crm': 'lead_qualified',
    'auto-appointment': 'lead_qualified',
    'followup-1day': 'first_message',
    'followup-3days': 'first_message',
    'notify-sales': 'lead_qualified',
    'weekly-report': 'weekly_schedule'
  };
  
  db.prepare(`
    INSERT INTO automations (id, user_id, name, trigger_event, actions, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(uuidv4(), userId, template.name, triggerMap[template_id], JSON.stringify(actionMap[template_id] || []));
  
  res.json({ success: true, message: 'Automazione creata con successo!' });
});

// Delete automation
router.post('/api/automation/delete', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const { id } = req.body;
  
  if (!validId(id)) return res.status(422).json({ error: 'Automazione non valida' });
  const result = db.prepare('DELETE FROM automations WHERE id = ? AND user_id = ?').run(id, userId);
  if (!result.changes) return res.status(404).json({ error: 'Automazione non trovata' });
  res.json({ success: true });
});

// Create invoice
router.post('/api/invoice/create', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const leadId = clean(req.body.lead_id, 100) || null;
  const amount = Number(req.body.amount);
  const items = Array.isArray(req.body.items) ? req.body.items.slice(0, 50) : [];
  const notes = clean(req.body.notes, 5000);
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) return res.status(422).json({ error: 'Importo non valido' });
  if (leadId && !db.prepare('SELECT id FROM leads WHERE id = ? AND user_id = ?').get(leadId, userId)) return res.status(404).json({ error: 'Lead non trovato' });
  
  const invoiceId = uuidv4();
  const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}-${invoiceId.slice(0, 4).toUpperCase()}`;
  
  db.prepare(`
    INSERT INTO invoices (id, user_id, lead_id, invoice_number, amount, items, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')
  `).run(invoiceId, userId, leadId, invoiceNumber, amount, JSON.stringify(items), notes);
  
  res.json({ success: true, invoiceId, invoiceNumber });
});

// Update lead status
router.post('/api/lead/update-status', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const { id, status } = req.body;
  if (!validId(id) || !['new', 'qualified', 'contacted', 'converted', 'lost'].includes(status)) return res.status(422).json({ error: 'Stato non valido' });
  
  const result = db.prepare('UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
    .run(status, id, userId);
  if (!result.changes) return res.status(404).json({ error: 'Lead non trovato' });
  
  res.json({ success: true });
});

// Update user settings
router.post('/api/settings/update', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const companyName = clean(req.body.company_name, 120);
  const sector = clean(req.body.sector, 80);
  const phone = clean(req.body.phone, 40);
  if (companyName.length < 2) return res.status(422).json({ error: 'Nome azienda non valido' });
  const existing = db.prepare('SELECT settings FROM users WHERE id = ?').get(userId);
  let settings = {};
  try { settings = JSON.parse(existing?.settings || '{}'); } catch {}
  
  db.prepare(`
    UPDATE users SET company_name = ?, sector = ?, phone = ?, settings = ?, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `).run(companyName, sector, phone, JSON.stringify(settings), userId);
  
  res.json({ success: true, message: 'Impostazioni aggiornate!' });
});

module.exports = router;
