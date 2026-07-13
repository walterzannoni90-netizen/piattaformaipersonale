/**
 * WES AI Automation - Main Server
 * Piattaforma di automazione AI per lead, WhatsApp, email, CRM e preventivi
 */
require('dotenv').config();

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const session = require('express-session');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const crypto = require('crypto');
const { limiter, apiLimiter } = require('./app/middleware/rateLimit');

const app = express();
const PORT = process.env.PORT || 3000;

if (process.env.NODE_ENV === 'production') {
  const missing = ['JWT_SECRET', 'SESSION_SECRET'].filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Configurazione di produzione incompleta: ${missing.join(', ')}`);
  app.set('trust proxy', 1);
}

// ============ SECURITY & MIDDLEWARE ============
app.use(helmet({
  contentSecurityPolicy: false, // Disabled for development - enable in production with proper config
}));
app.use(cors({
  origin: process.env.APP_URL || 'http://localhost:3000',
  credentials: true
}));

// Request logging
app.use(morgan('dev'));

// Stripe requires the untouched body to verify webhook signatures.
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// Body parsing
app.use(express.json({
  limit: '10mb',
  verify: (req, res, buffer) => { req.rawBody = buffer; }
}));
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Session (for flash messages, etc.)
app.use(session({
  secret: process.env.SESSION_SECRET || 'development-session-secret-change-me',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000
  }
}));

// Rate limiting
app.use(limiter);
app.use('/api/', apiLimiter);

// ============ STATIC FILES ============
app.use(express.static(path.join(__dirname, 'app/public')));

// ============ VIEW ENGINE ============
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'app/views'));

// Parse JWT from cookies for all requests
const jwt = require('jsonwebtoken');
app.use((req, res, next) => {
  const token = req.cookies?.token;
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
    } catch (e) {
      // Token expired or invalid
    }
  }
  next();
});

// Make user data available in all views
app.use((req, res, next) => {
  res.locals.currentUser = req.user || null;
  res.locals.appName = process.env.APP_NAME || 'WES AI Automation';
  res.locals.appUrl = process.env.APP_URL || 'http://localhost:3000';
  res.locals.contactEmail = process.env.CONTACT_EMAIL || 'info@wesautomation.com';
  res.locals.contactPhone = process.env.CONTACT_PHONE || '+39 02 1234 5678';
  res.locals.currentPath = req.path;
  res.locals.success = req.query.success;
  res.locals.error = req.query.error;
  next();
});

// ============ ROUTES ============

// ============ PUBLIC API (no auth required) ============

// Health check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    uptime: process.uptime()
  });
});

// Meta verifies this endpoint when the WhatsApp webhook is connected.
app.get('/api/whatsapp/webhook', (req, res) => {
  const valid = req.query['hub.mode'] === 'subscribe' &&
    req.query['hub.verify_token'] === process.env.WHATSAPP_VERIFY_TOKEN;
  if (!process.env.WHATSAPP_VERIFY_TOKEN || !valid) return res.sendStatus(403);
  return res.status(200).send(req.query['hub.challenge']);
});

app.post('/api/whatsapp/webhook', async (req, res) => {
  const signature = req.get('x-hub-signature-256');
  if (process.env.META_APP_SECRET) {
    const expected = `sha256=${crypto.createHmac('sha256', process.env.META_APP_SECRET).update(req.rawBody || '').digest('hex')}`;
    const validSignature = signature && signature.length === expected.length &&
      crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
    if (!validSignature) return res.sendStatus(401);
  }
  if (req.body?.object !== 'whatsapp_business_account') return res.sendStatus(400);
  try {
    const result = await require('./app/services/whatsapp').handleWebhook(req.body);
    if (result) {
      const { AutomationEngine } = require('./app/services/automation');
      await AutomationEngine.trigger('first_message', {
        user_id: result.userId,
        lead: result.lead,
        messages: JSON.parse(result.conversation.messages || '[]')
      });
      const db = require('./app/config/database').getDatabase();
      const agent = db.prepare('SELECT * FROM agents WHERE user_id = ? AND is_active = 1').get(result.userId);
      if (agent) {
        const history = JSON.parse(result.conversation.messages || '[]').slice(-10).map((message) => ({
          role: message.role === 'agent' ? 'assistant' : 'user',
          content: message.content
        }));
        const ai = await require('./app/services/openrouter').generateResponse(history, {
          ...agent,
          company_name: db.prepare('SELECT company_name FROM users WHERE id = ?').get(result.userId)?.company_name
        });
        if (ai.success) await require('./app/services/whatsapp').sendMessage(result.userId, result.lead.phone, ai.content);
      }
    }
    return res.sendStatus(200);
  } catch (error) {
    console.error('WhatsApp webhook error:', error.message);
    return res.sendStatus(500);
  }
});

// Stripe Webhook (raw body needed)
app.post('/api/stripe/webhook', async (req, res) => {
  const stripeService = require('./app/services/stripe');
  stripeService.init();
  
  const sig = req.headers['stripe-signature'];
  let event;
  
  try {
    if (stripeService.stripe) {
      event = stripeService.stripe.webhooks.constructEvent(
        req.body, sig, process.env.STRIPE_WEBHOOK_SECRET
      );
    } else {
      event = JSON.parse(req.body);
    }
    
    const result = await stripeService.handleWebhook(event);
    res.json(result);
  } catch (err) {
    console.error('Stripe webhook error:', err.message);
    res.status(400).send('Webhook Error: ' + err.message);
  }
});

// Public Chat (no auth needed, with optional agent)
app.post('/api/chat/send', async (req, res) => {
  const { messages, agentId } = req.body;
  const db = require('./app/config/database').getDatabase();
  
  try {
    let agent = null;
    if (agentId) {
      agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
    }
    
    if (!agent) {
      agent = {
        name: 'Agente WES',
        tone: 'professionale',
        company_name: 'WES AI Automation',
        qualification_questions: '[]',
        transfer_conditions: '{}'
      };
    } else {
      const user = db.prepare('SELECT company_name, sector FROM users WHERE id = ?').get(agent.user_id);
      if (user) {
        agent.company_name = user.company_name;
        agent.sector = user.sector;
      }
    }
    
    const openrouter = require('./app/services/openrouter');
    const result = await openrouter.generateResponse(messages, agent);
    
    res.json(result);
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ success: false, error: 'Errore durante la generazione della risposta' });
  }
});

// Stats API (needs auth - handled by the route)
app.get('/api/stats', (req, res) => {
  if (!req.user) return res.status(401).json({ error: 'Non autorizzato' });
  
  const db = require('./app/config/database').getDatabase();
  const userId = req.user.id;
  
  const stats = {
    leads: db.prepare('SELECT COUNT(*) as count FROM leads WHERE user_id = ?').get(userId).count,
    conversations: db.prepare('SELECT COUNT(*) as count FROM conversations WHERE user_id = ?').get(userId).count,
    appointments: db.prepare('SELECT COUNT(*) as count FROM appointments WHERE user_id = ?').get(userId).count,
    followUps: db.prepare('SELECT COUNT(*) as count FROM follow_ups WHERE user_id = ?').get(userId).count,
    newLeads: db.prepare("SELECT COUNT(*) as count FROM leads WHERE user_id = ? AND status = 'new'").get(userId).count,
    qualifiedLeads: db.prepare("SELECT COUNT(*) as count FROM leads WHERE user_id = ? AND status = 'qualified'").get(userId).count
  };
  
  res.json(stats);
});

// ============ VIEW ROUTES ============

// Public routes
const publicRoutes = require('./app/routes/public');
app.use(publicRoutes);

// Auth routes
const authRoutes = require('./app/routes/auth');
app.use(authRoutes);

// Dashboard routes (protected)
const dashboardRoutes = require('./app/routes/dashboard');
app.use(dashboardRoutes);

// Admin routes (protected + admin)
const adminRoutes = require('./app/routes/admin');
app.use(adminRoutes);

// ============ BACKGROUND JOBS ============
const { processPendingFollowUps } = require('./app/services/automation');

// Check pending follow-ups every 5 minutes
setInterval(async () => {
  try {
    await processPendingFollowUps();
  } catch (error) {
    console.error('Follow-up processing error:', error);
  }
}, 5 * 60 * 1000);

// ============ ERROR HANDLING ============

// 404 handler
app.use((req, res) => {
  if (req.path.startsWith('/api/')) {
    return res.status(404).json({ error: 'API endpoint non trovato' });
  }
  res.status(404).render('public/404', { 
    title: 'Pagina non trovata - WES AI Automation',
    message: 'La pagina che cerchi non esiste o è stata spostata.'
  });
});

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  
  // Log error
  const { getDatabase } = require('./app/config/database');
  const { v4: uuidv4 } = require('uuid');
  try {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO logs (id, user_id, level, action, details)
      VALUES (?, ?, 'error', 'server_error', ?)
    `).run(uuidv4(), req.user?.id, JSON.stringify({ 
      message: err.message, 
      stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
      path: req.path
    }));
  } catch (e) {}
  
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Errore interno del server' });
  }
  
  res.status(500).render('public/500', { 
    title: 'Errore - WES AI Automation',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Si è verificato un errore interno.'
  });
});

// ============ START SERVER ============
async function startServer() {
  try {
    // Initialize database
    const { initDatabase } = require('./app/config/database');
    await initDatabase();
    
    // Initialize Stripe
    const stripeService = require('./app/services/stripe');
    stripeService.init();
    
    if (process.env.SEED_DEMO_DATA === 'true' && process.env.NODE_ENV !== 'production') {
      await require('./database/setup')();
    }
    
    app.listen(PORT, () => {
      console.log(`
╔══════════════════════════════════════════════════════╗
║          WES AI Automation - Server Active          ║
╠══════════════════════════════════════════════════════╣
║  URL:     ${process.env.APP_URL || 'http://localhost:' + PORT}                    ║
║  Status:  ${process.env.NODE_ENV || 'development'}                          ║
║  API:     ${(process.env.APP_URL || 'http://localhost:' + PORT) + '/api/health'}         ║
╠══════════════════════════════════════════════════════╣
║  📧 Sito Pubblico:   /                              ║
║  🔐 Login:           /login                         ║
║  📊 Dashboard:       /dashboard                     ║
║  ⚙️ Admin:           /admin                         ║
╚══════════════════════════════════════════════════════╝
      `);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

if (require.main === module) startServer();

module.exports = { app, startServer };
