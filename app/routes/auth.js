/**
 * Authentication Routes
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../config/database');
const appConfig = require('../config/app');
const { authLimiter } = require('../middleware/rateLimit');

function safeRedirect(value, fallback) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : fallback;
}

const normalizeEmail = (value) => String(value || '').trim().toLowerCase();
const validPassword = (value) => typeof value === 'string' && value.length >= 10 && value.length <= 128;
const hashToken = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');

// GET /login
router.get('/login', (req, res) => {
  const { redirect } = req.query;
  res.render('public/login', { 
    title: 'Accedi - WES AI Automation',
    redirect,
    error: null
  });
});

// GET /register
router.get('/register', (req, res) => {
  if (!appConfig.isRegistrationOpen()) return res.redirect('/prenota-call?access=1');
  res.render('public/register', { 
    title: 'Registrati - WES AI Automation',
    error: null
  });
});

router.get('/password-dimenticata', (req, res) => {
  res.render('public/forgot-password', { title: 'Recupera password - WES', error: null, submitted: false });
});

router.get('/reset-password', (req, res) => {
  const token = String(req.query.token || '');
  const record = token.length >= 40 ? getDatabase().prepare(`
    SELECT id FROM password_reset_tokens
    WHERE token_hash = ? AND used_at IS NULL AND datetime(expires_at) > datetime('now')
  `).get(hashToken(token)) : null;
  res.status(record ? 200 : 400).render('public/reset-password', {
    title: 'Nuova password - WES', token: record ? token : '', valid: Boolean(record), error: record ? null : 'Il link non è valido oppure è scaduto.'
  });
});

// POST /auth/login
router.post('/auth/login', authLimiter, (req, res) => {
  const email = normalizeEmail(req.body.email);
  const { password, redirect } = req.body;
  const db = getDatabase();
  
  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ? AND status = ?').get(email, 'active');
    
    if (!user || typeof password !== 'string' || password.length > 128 || !bcrypt.compareSync(password, user.password)) {
      if (req.xhr) {
        return res.status(401).json({ error: 'Email o password non validi' });
      }
      return res.render('public/login', { 
        title: 'Accedi - WES AI Automation',
        redirect,
        error: 'Email o password non validi' 
      });
    }
    
    // Update last login
    db.prepare('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?').run(user.id);
    
    // Generate JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role, company: user.company_name, session_version: Number(user.session_version || 0) },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d', algorithm: 'HS256' }
    );
    
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      sameSite: 'lax'
    });
    
    // Log login
    db.prepare(`
      INSERT INTO logs (id, user_id, level, action, details)
      VALUES (?, ?, 'info', 'user_login', ?)
    `).run(uuidv4(), user.id, JSON.stringify({ ip: req.ip }));
    
    const redirectUrl = safeRedirect(redirect, user.role === 'admin' ? '/admin' : '/dashboard');
    
    if (req.xhr) {
      return res.json({ success: true, redirect: redirectUrl, user: { id: user.id, name: user.company_name, role: user.role } });
    }
    
    res.redirect(redirectUrl);
    
  } catch (error) {
    console.error('Login error:', error);
    if (req.xhr) {
      return res.status(500).json({ error: 'Errore interno del server' });
    }
    res.render('public/login', { 
      title: 'Accedi - WES AI Automation',
      redirect,
      error: 'Errore interno del server' 
    });
  }
});

// POST /auth/register
router.post('/auth/register', authLimiter, async (req, res) => {
  if (!appConfig.isRegistrationOpen()) {
    if (req.xhr || req.get('accept')?.includes('application/json')) {
      return res.status(403).json({ error: 'Le registrazioni dirette non sono attive. Richiedi l’accesso al team WES.' });
    }
    return res.redirect('/prenota-call?access=1');
  }
  const email = normalizeEmail(req.body.email);
  const company_name = String(req.body.company_name || '').trim();
  const password = req.body.password;
  const sector = String(req.body.sector || '').trim();
  const phone = String(req.body.phone || '').trim();
  const db = getDatabase();
  
  try {
    if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254 || company_name.length < 2 || company_name.length > 120 ||
      !validPassword(password) || sector.length > 80 || phone.length > 40) {
      const error = 'Inserisci un’email valida, un’azienda e una password di almeno 10 caratteri';
      if (req.xhr) return res.status(422).json({ error });
      return res.status(422).render('public/register', { title: 'Registrati - WES AI Automation', error });
    }
    // Check existing user
    const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
    if (existing) {
      if (req.xhr) {
        return res.status(400).json({ error: 'Email già registrata' });
      }
      return res.render('public/register', { 
        title: 'Registrati - WES AI Automation',
        error: 'Email già registrata' 
      });
    }
    
    // Create user
    const userId = uuidv4();
    const hashedPassword = bcrypt.hashSync(password, 12);
    
    db.prepare(`
      INSERT INTO users (id, email, password, company_name, sector, phone, role, plan)
      VALUES (?, ?, ?, ?, ?, ?, 'client', 'starter')
    `).run(userId, email, hashedPassword, company_name, sector || '', phone || '');
    
    // Create default agent
    const agentId = uuidv4();
    db.prepare(`
      INSERT INTO agents (id, user_id, name, tone, welcome_message)
      VALUES (?, ?, ?, 'professionale', ?)
    `).run(agentId, userId, `Agente ${company_name}`, `Ciao! Sono l'assistente virtuale di ${company_name}. Come posso aiutarti oggi?`);
    
    // Create default automations
    const defaultAutomations = [
      { name: 'Primo contatto sicuro', trigger: 'first_message', actions: ['send_welcome', 'score_lead'] },
      { name: 'Notifica commerciale', trigger: 'lead_qualified', actions: ['notify_sales_team'] }
    ];
    
    for (const auto of defaultAutomations) {
      db.prepare(`
        INSERT INTO automations (id, user_id, name, trigger_event, actions, is_active)
        VALUES (?, ?, ?, ?, ?, 1)
      `).run(uuidv4(), userId, auto.name, auto.trigger, JSON.stringify(auto.actions));
    }
    
    // Log
    db.prepare(`
      INSERT INTO logs (id, user_id, level, action, details)
      VALUES (?, ?, 'info', 'user_registered', ?)
    `).run(uuidv4(), userId, JSON.stringify({ email, company: company_name }));
    
    // Auto-login
    const token = jwt.sign(
      { id: userId, email, role: 'client', company: company_name, session_version: 0 },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d', algorithm: 'HS256' }
    );
    
    res.cookie('token', token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      sameSite: 'lax'
    });
    
    if (req.xhr) {
      return res.json({ success: true, redirect: '/dashboard' });
    }
    
    res.redirect('/dashboard');
    
  } catch (error) {
    console.error('Registration error:', error);
    if (req.xhr) {
      return res.status(500).json({ error: 'Errore durante la registrazione' });
    }
    res.render('public/register', { 
      title: 'Registrati - WES AI Automation',
      error: 'Errore durante la registrazione' 
    });
  }
});

router.post('/auth/password-dimenticata', authLimiter, async (req, res) => {
  const email = normalizeEmail(req.body.email);
  const db = getDatabase();
  const user = /^\S+@\S+\.\S+$/.test(email) ? db.prepare("SELECT id, email FROM users WHERE email = ? AND status = 'active'").get(email) : null;
  if (user) {
    const token = crypto.randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + 30 * 60 * 1000).toISOString();
    db.prepare('DELETE FROM password_reset_tokens WHERE user_id = ? AND used_at IS NULL').run(user.id);
    const resetId = uuidv4();
    db.prepare('INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at) VALUES (?, ?, ?, ?)')
      .run(resetId, user.id, hashToken(token), expiresAt);
    const baseUrl = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
    const resetUrl = `${baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
    const result = await require('../services/email').sendPlatformEmail(
      user.email,
      'Reimposta la password WES',
      `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto"><h1>Nuova password WES</h1><p>È stata richiesta la reimpostazione della password. Il link è valido per 30 minuti.</p><p><a href="${resetUrl}" style="display:inline-block;background:#6c63ff;color:white;padding:12px 18px;border-radius:10px;text-decoration:none">Scegli una nuova password</a></p><p>Se non hai fatto tu la richiesta, ignora questa email.</p></div>`
    );
    if (!result.success) {
      db.prepare('DELETE FROM password_reset_tokens WHERE id = ?').run(resetId);
      console.error('Password reset email not sent:', result.error);
    }
  }
  return res.render('public/forgot-password', {
    title: 'Recupera password - WES', error: null, submitted: true
  });
});

router.post('/auth/reset-password', authLimiter, (req, res) => {
  const token = String(req.body.token || '');
  const password = req.body.password;
  const confirmation = req.body.password_confirmation;
  const db = getDatabase();
  const record = token.length >= 40 ? db.prepare(`
    SELECT prt.id, prt.user_id FROM password_reset_tokens prt
    JOIN users u ON u.id = prt.user_id
    WHERE prt.token_hash = ? AND prt.used_at IS NULL AND datetime(prt.expires_at) > datetime('now') AND u.status = 'active'
  `).get(hashToken(token)) : null;
  if (!record || !validPassword(password) || password !== confirmation) {
    return res.status(422).render('public/reset-password', {
      title: 'Nuova password - WES', token: record ? token : '', valid: Boolean(record),
      error: record ? 'Le password devono coincidere e contenere almeno 10 caratteri.' : 'Il link non è valido oppure è scaduto.'
    });
  }
  db.prepare(`UPDATE users SET password = ?, session_version = session_version + 1,
    updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(bcrypt.hashSync(password, 12), record.user_id);
  db.prepare('UPDATE password_reset_tokens SET used_at = CURRENT_TIMESTAMP WHERE user_id = ? AND used_at IS NULL').run(record.user_id);
  db.prepare(`INSERT INTO logs (id, user_id, level, action, details) VALUES (?, ?, 'info', 'password_reset', '{}')`).run(uuidv4(), record.user_id);
  res.clearCookie('token');
  return res.redirect('/login?success=1');
});

// POST /auth/logout
router.post('/auth/logout', (req, res) => {
  res.clearCookie('token');
  if (req.xhr) {
    return res.json({ success: true });
  }
  res.redirect('/');
});

module.exports = router;
