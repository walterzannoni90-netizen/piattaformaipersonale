/**
 * Public Website Routes
 */
const express = require('express');
const router = express.Router();
const { getDatabase } = require('../config/database');
const { publicFormLimiter } = require('../middleware/rateLimit');
const { v4: uuidv4 } = require('uuid');
const { normalizePhone, validPhone } = require('../utils/contact');

const text = (value, max) => String(value || '').replace(/[\u0000-\u001F]/g, ' ').trim().slice(0, max);
const validEmail = (value) => /^\S+@\S+\.\S+$/.test(value) && value.length <= 254;

function formError(req, res, view, title, message, status = 422) {
  if (req.xhr || req.get('accept')?.includes('application/json')) return res.status(status).json({ success: false, error: message });
  return res.status(status).render(view, { title, error: message });
}

function zonedDateTimeToUtc(date, time, timeZone = 'Europe/Rome') {
  const desired = Date.parse(`${date}T${time}:00Z`);
  let instant = desired;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(new Date(instant)).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
    const observed = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second));
    instant += desired - observed;
  }
  return new Date(instant);
}

function matchesZonedInput(instant, date, time, timeZone = 'Europe/Rome') {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).formatToParts(instant).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return `${parts.year}-${parts.month}-${parts.day}` === date && `${parts.hour}:${parts.minute}` === time;
}

// Home page
router.get('/', (req, res) => {
  res.render('public/home', { 
    title: 'WES AI - L’agente autonomo che porta il lavoro fino al risultato',
    description: 'Affida un obiettivo a WES: pianifica, ricerca, analizza dati con Python, usa i tuoi strumenti e consegna risultati verificabili.'
  });
});

// Servizi
router.get('/servizi', (req, res) => {
  res.render('public/servizi', { 
    title: 'Servizi - WES AI Automation',
    description: 'Ricerca, analisi Python, memoria di progetto, CRM e azioni controllate: scopri gli strumenti operativi di WES.'
  });
});

// Casi d'uso
router.get('/casi-uso', (req, res) => {
  res.render('public/casi-uso', { 
    title: 'Casi d\'Uso - WES AI Automation',
    description: 'Esempi di workflow supportati da WES, con dati richiesti, strumenti usati e controlli prima delle azioni esterne.'
  });
});

// Prezzi
router.get('/prezzi', (req, res) => {
  const app = require('../config/app');
  res.render('public/prezzi', { 
    title: 'Prezzi - WES AI Automation',
    description: 'Piani e prezzi per ogni esigenza di automazione.',
    plans: app.plans
  });
});

// Contatti
router.get('/contatti', (req, res) => {
  res.render('public/contatti', { 
    title: 'Contatti - WES AI Automation',
    description: 'Contatta il team WES AI Automation.'
  });
});

// Prenota call
router.get('/prenota-call', (req, res) => {
  res.render('public/prenota-call', { 
    title: 'Prenota una Call - WES AI Automation',
    description: 'Invia una richiesta di call per valutare obiettivi, connettori e configurazione di WES.'
  });
});

router.get('/privacy', (req, res) => res.render('public/privacy', {
  title: 'Informativa privacy - WES', description: 'Informazioni sul trattamento dei dati personali nella piattaforma WES.'
}));

router.get('/cookie', (req, res) => res.render('public/cookie', {
  title: 'Cookie policy - WES', description: 'Informazioni sui cookie tecnici usati da WES.'
}));

router.get('/termini', (req, res) => res.render('public/termini', {
  title: 'Termini di servizio - WES', description: 'Condizioni di utilizzo della piattaforma WES.'
}));

// POST /contatti (form submission)
router.post('/contatti', publicFormLimiter, (req, res) => {
  if (req.body.website) return res.redirect('/contatti?success=1');
  const name = text(req.body.name, 120);
  const email = text(req.body.email, 254).toLowerCase();
  const phone = text(req.body.phone, 40);
  const normalizedPhone = normalizePhone(phone);
  const message = text(req.body.message, 5000);
  const db = getDatabase();
  if (name.length < 2 || !validEmail(email) || message.length < 10 || (phone && !validPhone(phone))) {
    return formError(req, res, 'public/contatti', 'Contatti - WES AI Automation', 'Controlla nome, email e messaggio.');
  }
  
  db.prepare('INSERT INTO inbound_requests (id, type, name, email, phone, message) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), 'contact', name, email, phone, message);
  
  // Find admin user to assign the lead
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (admin) {
    const leadId = uuidv4();
    db.prepare(`
      INSERT INTO leads (id, user_id, name, email, phone, phone_normalized, source, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, 'website', 'new', ?)
    `).run(leadId, admin.id, name, email, phone || '', normalizedPhone || null, message || '');
    
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
router.post('/prenota-call', publicFormLimiter, (req, res) => {
  if (req.body.website) return res.redirect('/prenota-call?success=1');
  const name = text(req.body.name, 120);
  const email = text(req.body.email, 254).toLowerCase();
  const phone = text(req.body.phone, 40);
  const normalizedPhone = normalizePhone(phone);
  const company = text(req.body.company, 120);
  const date = text(req.body.date, 10);
  const time = text(req.body.time, 5);
  const db = getDatabase();
  const allowedTimes = new Set(['09:00', '10:00', '11:00', '12:00', '14:00', '15:00', '16:00', '17:00', '18:00']);
  if (name.length < 2 || company.length < 2 || !validEmail(email) || (phone && !validPhone(phone)) || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !allowedTimes.has(time)) {
    return formError(req, res, 'public/prenota-call', 'Prenota una Call - WES AI Automation', 'Controlla i dati e seleziona un orario valido.');
  }
  const startTime = zonedDateTimeToUtc(date, time);
  const latest = Date.now() + 180 * 24 * 60 * 60 * 1000;
  if (!Number.isFinite(startTime.getTime()) || !matchesZonedInput(startTime, date, time) || startTime.getTime() < Date.now() + 15 * 60 * 1000 || startTime.getTime() > latest) {
    return formError(req, res, 'public/prenota-call', 'Prenota una Call - WES AI Automation', 'Scegli una data futura entro 180 giorni.');
  }
  
  const admin = db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
  if (admin && db.prepare("SELECT id FROM appointments WHERE user_id = ? AND start_time = ? AND status = 'scheduled'").get(admin.id, startTime.toISOString())) {
    return formError(req, res, 'public/prenota-call', 'Prenota una Call - WES AI Automation', 'Questo orario è già occupato. Scegline un altro.', 409);
  }

  db.prepare('INSERT INTO inbound_requests (id, type, name, email, phone, company, requested_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(uuidv4(), 'booking', name, email, phone, company, startTime.toISOString());
  if (admin) {
    const leadId = uuidv4();
    db.prepare(`
      INSERT INTO leads (id, user_id, name, email, phone, phone_normalized, source, status, notes)
      VALUES (?, ?, ?, ?, ?, ?, 'booking_call', 'new', ?)
    `).run(leadId, admin.id, name, email, phone || '', normalizedPhone || null, JSON.stringify({ company, requested_date: date, requested_time: time }));
    
    // Create appointment
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + 30);
    
    db.prepare(`
      INSERT INTO appointments (id, user_id, lead_id, title, description, start_time, end_time, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'scheduled')
    `).run(uuidv4(), admin.id, leadId, `Call con ${name} di ${company}`, 'Call di consulenza', 
      startTime.toISOString(), endTime.toISOString());
  }
  
  if (req.xhr) {
    return res.json({ success: true, message: 'Richiesta registrata. Ti ricontatteremo per la conferma.' });
  }
  
  res.redirect('/prenota-call?success=1');
});

module.exports = router;
