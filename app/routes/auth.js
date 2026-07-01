/**
 * Authentication Routes
 */
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../config/database');
const { authLimiter } = require('../middleware/rateLimit');

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
  res.render('public/register', { 
    title: 'Registrati - WES AI Automation',
    error: null
  });
});

// POST /auth/login
router.post('/auth/login', authLimiter, (req, res) => {
  const { email, password, redirect } = req.body;
  const db = getDatabase();
  
  try {
    const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
    
    if (!user || !bcrypt.compareSync(password, user.password)) {
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
      { id: user.id, email: user.email, role: user.role, company: user.company_name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
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
    
    const redirectUrl = redirect || (user.role === 'admin' ? '/admin' : '/dashboard');
    
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
router.post('/auth/register', async (req, res) => {
  const { email, password, company_name, sector, phone } = req.body;
  const db = getDatabase();
  
  try {
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
    const hashedPassword = bcrypt.hashSync(password, 10);
    
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
      { name: 'Risposta automatica ai lead', trigger: 'new_lead', actions: ['send_welcome'] },
      { name: 'Qualificazione cliente', trigger: 'first_message', actions: ['ask_questions', 'score_lead'] },
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
      { id: userId, email, role: 'client', company: company_name },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
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

// POST /auth/logout
router.post('/auth/logout', (req, res) => {
  res.clearCookie('token');
  if (req.xhr) {
    return res.json({ success: true });
  }
  res.redirect('/');
});

module.exports = router;
