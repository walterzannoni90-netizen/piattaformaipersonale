/**
 * Dashboard Routes (protected)
 */
const express = require('express');
const router = express.Router();
const { getDatabase } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');
const appConfig = require('../config/app');

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
  
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  const plan = appConfig.plans[user.plan] || appConfig.plans.starter;
  
  res.render('dashboard/index', {
    title: 'Dashboard - NUMMY',
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
  
  const status = req.query.status || '';
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
  };
  
  res.render('dashboard/leads', {
    title: 'Lead - NUMMY',
    leads,
    stats,
    currentStatus: status,
    page: 'leads'
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
  
  res.render('dashboard/conversations', {
    title: 'Conversazioni - NUMMY',
    conversations,
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
  
  res.render('dashboard/appointments', {
    title: 'Appuntamenti - NUMMY',
    appointments,
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
    title: 'Follow-up - NUMMY',
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
  
  res.render('dashboard/preventivi', {
    title: 'Preventivi - NUMMY',
    invoices,
    page: 'preventivi'
  });
});

// Automations
router.get('/dashboard/automazioni', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  
  const automations = db.prepare('SELECT * FROM automations WHERE user_id = ? ORDER BY created_at DESC').all(userId);
  
  res.render('dashboard/automations', {
    title: 'Automazioni - NUMMY',
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
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  
  res.render('dashboard/agent-config', {
    title: 'Configura Agente AI - NUMMY',
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
    title: 'Integrazioni - NUMMY',
    integrations,
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
  
  res.render('dashboard/stats', {
    title: 'Statistiche - NUMMY',
    usageStats,
    totalStats,
    page: 'stats'
  });
});

// Settings
router.get('/dashboard/impostazioni', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  
  res.render('dashboard/settings', {
    title: 'Impostazioni - NUMMY',
    user,
    page: 'settings'
  });
});

// ============ API endpoints for dashboard ============

// Update agent config
router.post('/api/agent/save', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const { name, tone, welcome_message, questions, transfer_conditions } = req.body;
  
  let agent = db.prepare('SELECT * FROM agents WHERE user_id = ?').get(userId);
  
  if (agent) {
    db.prepare(`
      UPDATE agents SET name = ?, tone = ?, welcome_message = ?, qualification_questions = ?, transfer_conditions = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(name, tone, welcome_message, JSON.stringify(questions || []), JSON.stringify(transfer_conditions || {}), agent.id);
  } else {
    const agentId = uuidv4();
    agent = { id: agentId };
    db.prepare(`
      INSERT INTO agents (id, user_id, name, tone, welcome_message, qualification_questions, transfer_conditions)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(agentId, userId, name, tone, welcome_message, JSON.stringify(questions || []), JSON.stringify(transfer_conditions || {}));
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
  
  db.prepare('UPDATE automations SET is_active = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
    .run(is_active ? 1 : 0, id, userId);
  
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
    'followup-3days': ['send_followup'],
    'notify-sales': ['notify_sales_team'],
    'weekly-report': ['generate_report']
  };
  
  db.prepare(`
    INSERT INTO automations (id, user_id, name, trigger_event, actions, is_active)
    VALUES (?, ?, ?, ?, ?, 1)
  `).run(uuidv4(), userId, template.name, template_id, JSON.stringify(actionMap[template_id] || []));
  
  res.json({ success: true, message: 'Automazione creata con successo!' });
});

// Delete automation
router.post('/api/automation/delete', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const { id } = req.body;
  
  db.prepare('DELETE FROM automations WHERE id = ? AND user_id = ?').run(id, userId);
  res.json({ success: true });
});

// Create invoice
router.post('/api/invoice/create', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const { lead_id, amount, items, notes } = req.body;
  
  const invoiceId = uuidv4();
  const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;
  
  db.prepare(`
    INSERT INTO invoices (id, user_id, lead_id, invoice_number, amount, items, notes, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'draft')
  `).run(invoiceId, userId, lead_id || null, invoiceNumber, amount, JSON.stringify(items || []), notes || '');
  
  res.json({ success: true, invoiceId, invoiceNumber });
});

// Update lead status
router.post('/api/lead/update-status', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const { id, status } = req.body;
  
  db.prepare('UPDATE leads SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
    .run(status, id, userId);
  
  res.json({ success: true });
});

// Update user settings
router.post('/api/settings/update', (req, res) => {
  const db = getDatabase();
  const userId = req.user.id;
  const { company_name, sector, phone, settings } = req.body;
  
  db.prepare(`
    UPDATE users SET company_name = ?, sector = ?, phone = ?, settings = ?, updated_at = CURRENT_TIMESTAMP 
    WHERE id = ?
  `).run(company_name, sector, phone, JSON.stringify(settings || {}), userId);
  
  res.json({ success: true, message: 'Impostazioni aggiornate!' });
});

module.exports = router;
