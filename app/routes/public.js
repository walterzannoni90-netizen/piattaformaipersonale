/**
 * Public Website Routes
 */
const express = require('express');
const router = express.Router();
const { getDatabase } = require('../config/database');
const { optionalAuth } = require('../middleware/auth');

// Home page
router.get('/', (req, res) => {
  res.render('public/home', { 
    title: 'NUMMY - Automazione Intelligente per la Tua Azienda',
    description: 'Automatizza lead, WhatsApp, email, CRM e preventivi con l\'intelligenza artificiale.'
  });
});

// Servizi
router.get('/servizi', (req, res) => {
  res.render('public/servizi', { 
    title: 'Servizi - NUMMY',
    description: 'Scopri tutti i servizi di automazione AI per la tua azienda.'
  });
});

// Casi d'uso
router.get('/casi-uso', (req, res) => {
  res.render('public/casi-uso', { 
    title: 'Casi d\'Uso - NUMMY',
    description: 'Esempi reali di automazione AI per diversi settori.'
  });
});

// Prezzi
router.get('/prezzi', (req, res) => {
  const app = require('../config/app');
  res.render('public/prezzi', { 
    title: 'Prezzi - NUMMY',
    description: 'Piani e prezzi per ogni esigenza di automazione.',
    plans: app.plans
  });
});

// Contatti
router.get('/contatti', (req, res) => {
  res.render('public/contatti', { 
    title: 'Contatti - NUMMY',
    description: 'Contatta il team NUMMY.'
  });
});

// Prenota call
router.get('/prenota-call', (req, res) => {
  res.render('public/prenota-call', { 
    title: 'Prenota una Call - NUMMY',
    description: 'Prenota una consulenza gratuita con il nostro team.'
  });
});

// POST /contatti (form submission)
router.post('/contatti', (req, res) => {
  const { name, email, phone, message } = req.body;
  const db = getDatabase();
  
  // Create a lead from contact form
  const { v4: uuidv4 } = require('uuid');
  
  // Find admin user to assign the lead
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (admin) {
    const leadId = uuidv4();
    db.prepare(`
      INSERT INTO leads (id, user_id, name, email, phone, source, status, notes)
      VALUES (?, ?, ?, ?, ?, 'website', 'new', ?)
    `).run(leadId, admin.id, name, email, phone || '', message || '');
    
    db.prepare(`
      INSERT INTO logs (id, user_id, level, action, details)
      VALUES (?, ?, 'info', 'contact_form_submitted', ?)
    `).run(uuidv4(), admin.id, JSON.stringify({ name, email }));
  }
  
  if (req.xhr) {
    return res.json({ success: true, message: 'Grazie per averci contattato! Ti risponderemo al più presto.' });
  }
  
  res.redirect('/contatti?success=1');
});

// Prenota call
router.post('/prenota-call', (req, res) => {
  const { name, email, phone, company, date, time } = req.body;
  const db = getDatabase();
  const { v4: uuidv4 } = require('uuid');
  
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (admin) {
    const leadId = uuidv4();
    db.prepare(`
      INSERT INTO leads (id, user_id, name, email, phone, source, status, notes)
      VALUES (?, ?, ?, ?, ?, 'booking_call', 'new', ?)
    `).run(leadId, admin.id, name, email, phone || '', JSON.stringify({ company, requested_date: date, requested_time: time }));
    
    // Create appointment
    const startTime = new Date(`${date}T${time}`);
    const endTime = new Date(startTime);
    endTime.setHours(endTime.getHours() + 1);
    
    db.prepare(`
      INSERT INTO appointments (id, user_id, lead_id, title, description, start_time, end_time, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled')
    `).run(uuidv4(), admin.id, leadId, `Call con ${name} di ${company}`, 'Call di consulenza', 
      startTime.toISOString(), endTime.toISOString());
  }
  
  if (req.xhr) {
    return res.json({ success: true, message: 'Call prenotata con successo! Riceverai una conferma via email.' });
  }
  
  res.redirect('/prenota-call?success=1');
});

module.exports = router;
