const jwt = require('jsonwebtoken');

function authenticate(req, res, next) {
  const token = req.cookies?.token || req.headers?.authorization?.replace('Bearer ', '');
  
  if (!token) {
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Autenticazione richiesta' });
    }
    return res.redirect('/login?redirect=' + encodeURIComponent(req.originalUrl));
  }
  
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded;
    next();
  } catch (err) {
    if (req.xhr || req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Token non valido o scaduto' });
    }
    return res.redirect('/login');
  }
}

function optionalAuth(req, res, next) {
  const token = req.cookies?.token || req.headers?.authorization?.replace('Bearer ', '');
  
  if (token) {
    try {
      req.user = jwt.verify(token, process.env.JWT_SECRET);
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

module.exports = { authenticate, optionalAuth, requireAdmin };
