/**
 * Admin Routes (hidden backend)
 */
const express = require('express');
const router = express.Router();
const { getDatabase } = require('../config/database');
const { authenticate, requireAdmin } = require('../middleware/auth');
const { v4: uuidv4 } = require('uuid');

// All admin routes require authentication + admin role
router.use(authenticate);
router.use(requireAdmin);

// Admin dashboard
router.get('/admin', (req, res) => {
  const db = getDatabase();
  
  const stats = {
    totalUsers: db.prepare('SELECT COUNT(*) as count FROM users').get(),
    totalLeads: db.prepare('SELECT COUNT(*) as count FROM leads').get(),
    totalConversations: db.prepare('SELECT COUNT(*) as count FROM conversations').get(),
    totalAppointments: db.prepare('SELECT COUNT(*) as count FROM appointments').get(),
    activeSubscriptions: db.prepare("SELECT COUNT(*) as count FROM subscriptions WHERE status = 'active'").get(),
    totalRevenue: 0
  };
  
  // Calculate revenue (simplified)
  const subscriptions = db.prepare('SELECT plan FROM subscriptions WHERE status = "active"').all();
  const plans = require('../config/app').plans;
  stats.totalRevenue = subscriptions.reduce((sum, sub) => sum + (plans[sub.plan]?.price || 0), 0);
  
  // Recent registrations
  const recentUsers = db.prepare('SELECT * FROM users ORDER BY created_at DESC LIMIT 10').all();
  
  // Recent logs
  const recentLogs = db.prepare('SELECT * FROM logs ORDER BY created_at DESC LIMIT 20').all();
  
  // Leads by status
  const leadsByStatus = {
    new: db.prepare("SELECT COUNT(*) as count FROM leads WHERE status = 'new'").get().count,
    qualified: db.prepare("SELECT COUNT(*) as count FROM leads WHERE status = 'qualified'").get().count,
    contacted: db.prepare("SELECT COUNT(*) as count FROM leads WHERE status = 'contacted'").get().count,
    converted: db.prepare("SELECT COUNT(*) as count FROM leads WHERE status = 'converted'").get().count
  };
  
  res.render('admin/index', {
    title: 'Admin - WES AI Automation',
    stats,
    recentUsers,
    recentLogs,
    leadsByStatus,
    adminPage: true
  });
});

// Users management
router.get('/admin/utenti', (req, res) => {
  const db = getDatabase();
  const users = db.prepare('SELECT * FROM users ORDER BY created_at DESC').all();
  
  res.render('admin/users', {
    title: 'Gestione Utenti - WES AI Automation',
    users,
    adminPage: true
  });
});

// User details
router.get('/admin/utenti/:id', (req, res) => {
  const db = getDatabase();
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.params.id);
  
  if (!user) return res.redirect('/admin/utenti');
  
  const stats = {
    leads: db.prepare('SELECT COUNT(*) as count FROM leads WHERE user_id = ?').get(user.id),
    conversations: db.prepare('SELECT COUNT(*) as count FROM conversations WHERE user_id = ?').get(user.id),
    appointments: db.prepare('SELECT COUNT(*) as count FROM appointments WHERE user_id = ?').get(user.id),
    automations: db.prepare('SELECT COUNT(*) as count FROM automations WHERE user_id = ?').get(user.id)
  };
  
  const subscription = db.prepare('SELECT * FROM subscriptions WHERE user_id = ?').get(user.id);
  const agent = db.prepare('SELECT * FROM agents WHERE user_id = ?').get(user.id);
  
  res.render('admin/user-detail', {
    title: `Utente: ${user.company_name} - WES AI Automation`,
    user,
    stats,
    subscription,
    agent,
    page: 'admin'
  });
});

// Logs
router.get('/admin/logs', (req, res) => {
  const db = getDatabase();
  const level = req.query.level || '';
  const userId = req.query.user_id || '';
  const currentPage = parseInt(req.query.page) || 1;
  const perPage = 50;
  
  let query = 'SELECT l.*, u.company_name FROM logs l LEFT JOIN users u ON u.id = l.user_id';
  const conditions = [];
  const params = [];
  
  if (level) {
    conditions.push('l.level = ?');
    params.push(level);
  }
  if (userId) {
    conditions.push('l.user_id = ?');
    params.push(userId);
  }
  
  if (conditions.length > 0) {
    query += ' WHERE ' + conditions.join(' AND ');
  }
  
  query += ' ORDER BY l.created_at DESC LIMIT ? OFFSET ?';
  params.push(perPage, (currentPage - 1) * perPage);
  
  const logs = db.prepare(query).all(...params);
  
  const totalLogs = db.prepare('SELECT COUNT(*) as count FROM logs').get().count;
  const totalPages = Math.ceil(totalLogs / perPage);
  
  res.render('admin/logs', {
    title: 'Log di Sistema - WES AI Automation',
    logs,
    page: currentPage,
    totalPages,
    totalLogs,
    level,
    userId
  });
});

// API Keys
router.get('/admin/api-keys', (req, res) => {
  const db = getDatabase();
  const keys = db.prepare(`
    SELECT ak.*, u.company_name 
    FROM api_keys ak 
    LEFT JOIN users u ON u.id = ak.user_id 
    ORDER BY ak.created_at DESC
  `).all();
  
  res.render('admin/api-keys', {
    title: 'API Keys - WES AI Automation',
    keys,
    adminPage: true
  });
});

// System Config
router.get('/admin/config', (req, res) => {
  const app = require('../config/app');
  
  res.render('admin/config', {
    title: 'Configurazione - WES AI Automation',
    config: app,
    env: {
      PORT: process.env.PORT,
      NODE_ENV: process.env.NODE_ENV,
      APP_URL: process.env.APP_URL,
      OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
      DB_PATH: process.env.DB_PATH
    },
    adminPage: true
  });
});

// Admin API
router.post('/api/admin/user/update', (req, res) => {
  const db = getDatabase();
  const { id, plan, role, status } = req.body;
  
  if (plan) db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, id);
  if (role) db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
  if (status) db.prepare('UPDATE users SET status = ? WHERE id = ?').run(status, id);
  
  db.prepare(`
    INSERT INTO logs (id, user_id, level, action, details)
    VALUES (?, ?, 'admin', 'user_updated', ?)
  `).run(uuidv4(), req.user.id, JSON.stringify({ updatedUserId: id, changes: req.body }));
  
  res.json({ success: true });
});

router.post('/api/admin/user/delete', (req, res) => {
  const db = getDatabase();
  const { id } = req.body;
  
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  res.json({ success: true });
});

router.post('/api/admin/logs/clear', (req, res) => {
  const db = getDatabase();
  db.prepare('DELETE FROM logs WHERE created_at < datetime("now", "-30 days")').run();
  res.json({ success: true, message: 'Log più vecchi di 30 giorni eliminati' });
});

module.exports = router;
