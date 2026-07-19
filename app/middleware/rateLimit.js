const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 600,
  message: { error: 'Troppe richieste, riprova più tardi.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => ['/api/health', '/api/whatsapp/webhook', '/api/stripe/webhook'].includes(req.originalUrl.split('?')[0]),
});

const apiLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 180,
  message: { error: 'Limite API superato. Attendi 1 minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => ['/api/health', '/api/whatsapp/webhook', '/api/stripe/webhook'].includes(req.originalUrl.split('?')[0]),
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  message: { error: 'Troppi tentativi di accesso. Riprova tra 15 minuti.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const publicFormLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 12,
  message: { error: 'Troppe richieste inviate. Riprova più tardi.' },
  standardHeaders: true,
  legacyHeaders: false,
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 15,
  message: { error: 'Limite chat raggiunto. Attendi un minuto.' },
  standardHeaders: true,
  legacyHeaders: false,
});

module.exports = { limiter, apiLimiter, authLimiter, publicFormLimiter, chatLimiter };
