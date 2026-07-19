const jwt = require('jsonwebtoken');
const { getDatabase } = require('../config/database');

function tokenFromRequest(req) {
  const authorization = String(req.headers?.authorization || '');
  return req.cookies?.token || (authorization.startsWith('Bearer ') ? authorization.slice(7) : null);
}

function verifiedUser(token) {
  const decoded = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] });
  const user = getDatabase().prepare('SELECT id, email, role, company_name, plan, status, session_version FROM users WHERE id = ?').get(decoded.id);
  if (!user || user.status !== 'active') throw new Error('Account non attivo');
  if (!Number.isInteger(decoded.session_version) || decoded.session_version !== Number(user.session_version || 0)) {
    throw new Error('Sessione revocata');
  }
  return { id: user.id, email: user.email, role: user.role, company: user.company_name, plan: user.plan };
}

function authenticate(req, res, next) {
  if (req.user?.id) return next();
  const token = tokenFromRequest(req);
  
  if (!token) {
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Autenticazione richiesta' });
    }
    return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
  }
  
  try {
    req.user = verifiedUser(token);
    next();
  } catch (err) {
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Token non valido o scaduto' });
    }
    return res.redirect('/login');
  }
}

function optionalAuth(req, res, next) {
  const token = tokenFromRequest(req);
  
  if (token) {
    try {
      req.user = verifiedUser(token);
    } catch (err) {
      // Ignore invalid token
    }
  }
  
  next();
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'Accesso negato. Richiesti privilegi amministrativi.' });
    }
    return res.redirect('/dashboard');
  }
  next();
}

module.exports = { authenticate, optionalAuth, requireAdmin, tokenFromRequest, verifiedUser };
