/**
 * WES AI Automation - Main Server
 * Piattaforma di automazione AI per lead, WhatsApp, email, CRM e preventivi
 */
require('dotenv').config();

const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const crypto = require('crypto');
const { limiter, apiLimiter, chatLimiter } = require('./app/middleware/rateLimit');

const app = express();
const PORT = process.env.PORT || 3000;
let httpServer = null;
let pythonRuntime = { ready: false, binary: process.env.PYTHON_BIN || 'python3', error: 'Server non avviato' };

if (process.env.NODE_ENV === 'production') {
  const missing = ['JWT_SECRET', 'APP_ENCRYPTION_KEY', 'APP_URL', 'CONTACT_EMAIL', 'LEGAL_NAME', 'LEGAL_ADDRESS', 'VAT_NUMBER', 'PRIVACY_EMAIL'].filter((key) => !process.env[key]);
  if (missing.length) throw new Error(`Configurazione di produzione incompleta: ${missing.join(', ')}`);
  for (const key of ['JWT_SECRET', 'APP_ENCRYPTION_KEY']) {
    if (String(process.env[key]).length < 32) throw new Error(`${key} deve contenere almeno 32 caratteri`);
  }
  const appUrl = new URL(process.env.APP_URL);
  if (appUrl.protocol !== 'https:' && process.env.ALLOW_INSECURE_HTTP !== 'true') throw new Error('APP_URL deve usare HTTPS in produzione');
  if ((process.env.STRIPE_SECRET_KEY || process.env.STRIPE_WEBHOOK_SECRET) && (!process.env.STRIPE_SECRET_KEY || !process.env.STRIPE_WEBHOOK_SECRET)) {
    throw new Error('Stripe richiede STRIPE_SECRET_KEY e STRIPE_WEBHOOK_SECRET');
  }
  if ((process.env.WHATSAPP_API_KEY || process.env.WHATSAPP_PHONE_ID) &&
      (!process.env.WHATSAPP_API_KEY || !process.env.WHATSAPP_PHONE_ID || !process.env.WHATSAPP_VERIFY_TOKEN || !process.env.META_APP_SECRET)) {
    throw new Error('WhatsApp richiede token, phone ID, verify token e Meta app secret');
  }
  app.set('trust proxy', 1);
}

// ============ SECURITY & MIDDLEWARE ============
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      fontSrc: ["'self'", 'data:'],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
      formAction: ["'self'"],
      upgradeInsecureRequests: process.env.NODE_ENV === 'production' ? [] : null
    }
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({
  origin: process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000',
  credentials: true
}));

// Request logging
if (process.env.NODE_ENV !== 'test') app.use(morgan('dev'));

// Stripe requires the untouched body to verify webhook signatures.
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));

// Body parsing
app.use(express.json({
  limit: '1mb',
  verify: (req, res, buffer) => { req.rawBody = buffer; }
}));
app.use(express.urlencoded({ extended: true, limit: '100kb', parameterLimit: 100 }));
app.use(cookieParser());

// Cookie-authenticated mutations must originate from this application.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method) || !req.cookies?.token || req.get('authorization')) return next();
  const source = req.get('origin') || req.get('referer');
  if (!source) return next();
  try {
    const expected = new URL(process.env.APP_URL || `${req.protocol}://${req.get('host')}`).origin;
    if (new URL(source).origin !== expected) return res.status(403).json({ error: 'Origine richiesta non valida' });
  } catch { return res.status(403).json({ error: 'Origine richiesta non valida' }); }
  next();
});

// Rate limiting
app.use(limiter);
app.use('/api/', apiLimiter);

// ============ STATIC FILES ============
app.use('/vendor/fontawesome/css', express.static(path.join(__dirname, 'node_modules/@fortawesome/fontawesome-free/css'), { maxAge: '30d', immutable: true }));
app.use('/vendor/fontawesome/webfonts', express.static(path.join(__dirname, 'node_modules/@fortawesome/fontawesome-free/webfonts'), { maxAge: '30d', immutable: true }));
app.use(express.static(path.join(__dirname, 'app/public')));

// ============ VIEW ENGINE ============
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'app/views'));

// Parse and revalidate the current account for public and protected views.
app.use(require('./app/middleware/auth').optionalAuth);

// Make user data available in all views
app.use((req, res, next) => {
  const registrationOpen = require('./app/config/app').isRegistrationOpen();
  res.locals.currentUser = req.user || null;
  res.locals.appName = process.env.APP_NAME || 'WES AI Automation';
  res.locals.appUrl = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
  res.locals.contactEmail = process.env.CONTACT_EMAIL || 'info@wesautomation.com';
  res.locals.contactPhone = process.env.CONTACT_PHONE || '';
  res.locals.contactLocation = process.env.CONTACT_LOCATION || '';
  res.locals.legal = {
    name: process.env.LEGAL_NAME || 'Titolare da configurare',
    address: process.env.LEGAL_ADDRESS || 'Sede da configurare',
    vat: process.env.VAT_NUMBER || 'Partita IVA da configurare',
    privacyEmail: process.env.PRIVACY_EMAIL || process.env.CONTACT_EMAIL || 'privacy@example.com',
    reviewed: process.env.LEGAL_REVIEWED === 'true'
  };
  res.locals.currentPath = req.path;
  res.locals.registrationOpen = registrationOpen;
  res.locals.signupUrl = registrationOpen ? '/register' : '/prenota-call';
  res.locals.signupLabel = registrationOpen ? 'Prova WES' : 'Richiedi accesso';
  res.locals.success = req.query.success;
  res.locals.error = req.query.error;
  next();
});

// ============ ROUTES ============

// ============ PUBLIC API (no auth required) ============

// Health check
app.get('/api/health', (req, res) => {
  require('./app/config/database').getDatabase().prepare('SELECT 1 AS ready').get();
  res.json({
    status: pythonRuntime.ready ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    version: '1.0.0',
    uptime: process.uptime(),
    checks: { database: 'ready', python: pythonRuntime.ready ? 'ready' : 'unavailable' }
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
  if (!process.env.META_APP_SECRET) return res.sendStatus(503);
  const expected = `sha256=${crypto.createHmac('sha256', process.env.META_APP_SECRET).update(req.rawBody || '').digest('hex')}`;
  const validSignature = signature && signature.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!validSignature) return res.sendStatus(401);
  if (req.body?.object !== 'whatsapp_business_account') return res.sendStatus(400);
  try {
    const incomingResults = await require('./app/services/whatsapp').handleWebhook(req.body);
    const groupedResults = new Map();
    for (const item of incomingResults) {
      const existing = groupedResults.get(item.conversation.id);
      groupedResults.set(item.conversation.id, existing ? { ...item, isFirstMessage: existing.isFirstMessage || item.isFirstMessage } : item);
    }
    for (const result of groupedResults.values()) {
      const { AutomationEngine } = require('./app/services/automation');
      await AutomationEngine.trigger(result.isFirstMessage ? 'first_message' : 'message_received', {
        user_id: result.userId,
        lead: result.lead,
        messages: JSON.parse(result.conversation.messages || '[]')
      });
      const db = require('./app/config/database').getDatabase();
      const agent = db.prepare('SELECT * FROM agents WHERE user_id = ? AND is_active = 1').get(result.userId);
      const initialMessages = JSON.parse(result.conversation.messages || '[]');
      const latestConversation = db.prepare('SELECT messages FROM conversations WHERE id = ? AND user_id = ?').get(result.conversation.id, result.userId);
      const latestMessages = JSON.parse(latestConversation?.messages || '[]');
      const automationReplied = latestMessages.slice(initialMessages.length).some((message) => message.role === 'agent');
      if (agent && !automationReplied) {
        const account = db.prepare('SELECT company_name, sector, settings FROM users WHERE id = ?').get(result.userId) || {};
        let settings = {};
        try { settings = JSON.parse(account.settings || '{}'); } catch {}
        const history = latestMessages.slice(-10).map((message) => ({
          role: message.role === 'agent' ? 'assistant' : 'user',
          content: message.content
        }));
        const ai = await require('./app/services/openrouter').generateResponse(history, {
          ...agent,
          company_name: account.company_name,
          sector: account.sector
        }, {
          openrouterApiKey: require('./app/services/secretVault').getSecret(result.userId, 'openrouter'),
          openrouterModel: settings.agent_model
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
  if (!stripeService.stripe || !process.env.STRIPE_WEBHOOK_SECRET) {
    return res.status(503).json({ error: 'Webhook Stripe non configurato' });
  }
  
  const sig = req.headers['stripe-signature'];
  let event;
  
  try {
    event = stripeService.stripe.webhooks.constructEvent(
      req.body, sig, process.env.STRIPE_WEBHOOK_SECRET
    );
    
    const result = await stripeService.handleWebhook(event);
    res.json(result);
  } catch (err) {
    console.error('Stripe webhook error:', err.message);
    res.status(400).send('Webhook Error: ' + err.message);
  }
});

// Public Chat (no auth needed, with optional agent)
app.post('/api/chat/send', chatLimiter, async (req, res) => {
  const agentId = typeof req.body.agentId === 'string' ? req.body.agentId.slice(0, 100) : '';
  const db = require('./app/config/database').getDatabase();
  
  try {
    if (!agentId || !Array.isArray(req.body.messages) || req.body.messages.length < 1 || req.body.messages.length > 20) {
      return res.status(422).json({ success: false, error: 'Conversazione non valida' });
    }
    const messages = req.body.messages.slice(-12).map((message) => ({
      role: ['user', 'assistant'].includes(message?.role) ? message.role : 'user',
      content: String(message?.content || '').trim().slice(0, 4000)
    })).filter((message) => message.content);
    if (!messages.length || messages[messages.length - 1].role !== 'user' || messages.reduce((total, message) => total + message.content.length, 0) > 16_000) {
      return res.status(422).json({ success: false, error: 'Messaggi troppo lunghi o mancanti' });
    }
    const agent = db.prepare(`SELECT a.*, u.company_name, u.sector, u.settings
      FROM agents a JOIN users u ON u.id = a.user_id
      WHERE a.id = ? AND a.is_active = 1 AND u.status = 'active'`).get(agentId);
    if (!agent) return res.status(404).json({ success: false, error: 'Agente non trovato' });
    let ownerSettings = {};
    try { ownerSettings = JSON.parse(agent.settings || '{}'); } catch {}
    delete agent.settings;
    if (!require('./app/services/secretVault').getSecret(agent.user_id, 'openrouter') && !process.env.OPENROUTER_API_KEY) {
      return res.status(503).json({ success: false, code: 'AI_NOT_CONFIGURED', error: 'Agente non configurato' });
    }
    
    const openrouter = require('./app/services/openrouter');
    const personalKey = agent.user_id ? require('./app/services/secretVault').getSecret(agent.user_id, 'openrouter') : null;
    const result = await openrouter.generateResponse(messages, agent, { openrouterApiKey: personalKey, openrouterModel: ownerSettings.agent_model });
    
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

// Autonomous agent workspace (protected)
const workspaceRoutes = require('./app/routes/workspace');
app.use(workspaceRoutes);

// Admin routes (protected + admin)
const adminRoutes = require('./app/routes/admin');
app.use(adminRoutes);

// ============ BACKGROUND JOBS ============
const { processPendingFollowUps, processScheduledAutomations } = require('./app/services/automation');

// Check pending follow-ups every 5 minutes
const automationTimer = setInterval(async () => {
  try {
    await processPendingFollowUps();
    await processScheduledAutomations();
  } catch (error) {
    console.error('Follow-up processing error:', error);
  }
}, 5 * 60 * 1000);
automationTimer.unref?.();

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

    pythonRuntime = require('./app/services/pythonRunner').checkPythonRuntime();
    if (!pythonRuntime.ready && process.env.NODE_ENV === 'production') throw new Error(`Runtime Python non pronto: ${pythonRuntime.error}`);
    if (!pythonRuntime.ready) console.warn(`Runtime Python non pronto: ${pythonRuntime.error}`);

    require('./app/services/automation').recoverInterruptedFollowUps();
    // Continue safe in-flight tasks after a process restart.
    require('./app/services/agentOrchestrator').resumeRecoverableTasks();
    require('./app/services/scheduleService').start();
    require('./app/services/dataRetention').start();
    
    // Initialize Stripe
    const stripeService = require('./app/services/stripe');
    stripeService.init();
    
    if (process.env.SEED_DEMO_DATA === 'true' && process.env.NODE_ENV !== 'production') {
      await require('./database/setup')();
    }
    
    httpServer = app.listen(PORT, () => {
      if (process.env.NODE_ENV !== 'test') console.log(`
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
    return httpServer;
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

async function shutdown(signal) {
  if (!httpServer) return;
  console.log(`${signal}: arresto controllato in corso`);
  const server = httpServer;
  httpServer = null;
  const closed = new Promise((resolve) => server.close(resolve));
  clearInterval(automationTimer);
  require('./app/services/scheduleService').stop();
  require('./app/services/dataRetention').stop();
  const deadline = new Promise((resolve) => {
    const timer = setTimeout(resolve, 25_000);
    timer.unref?.();
  });
  await Promise.all([
    require('./app/services/agentOrchestrator').shutdown(25_000),
    Promise.race([closed, deadline])
  ]);
  process.exit(0);
}

if (require.main === module) {
  process.once('SIGTERM', () => shutdown('SIGTERM'));
  process.once('SIGINT', () => shutdown('SIGINT'));
}

if (require.main === module) startServer();

module.exports = { app, startServer };
