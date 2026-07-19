'use strict';

const crypto = require('crypto');

const READ_ACTIONS = new Set(['navigate', 'screenshot', 'extract']);
const WRITE_ACTIONS = new Set(['download', 'upload', 'submit']);
const ALLOWED_PROTOCOLS = new Set(['https:', 'http:']);

function validateBrowserCommand(command = {}) {
  const action = String(command.action || '').trim();
  if (!READ_ACTIONS.has(action) && !WRITE_ACTIONS.has(action)) throw new Error('Azione browser non consentita');

  const normalized = { action };
  if (command.url != null) normalized.url = normalizePublicUrl(command.url);
  if (command.selector != null) normalized.selector = normalizeSelector(command.selector);
  if (command.value != null) normalized.value = String(command.value).slice(0, 20_000);
  if (command.filename != null) normalized.filename = normalizeFilename(command.filename);

  if (action === 'navigate' && !normalized.url) throw new Error('URL obbligatorio');
  if (['extract', 'upload', 'submit'].includes(action) && !normalized.selector) throw new Error('Selettore obbligatorio');
  if (action === 'upload' && !normalized.filename) throw new Error('Nome file obbligatorio');

  return Object.freeze(normalized);
}

function requiresBrowserApproval(command) {
  const normalized = validateBrowserCommand(command);
  return WRITE_ACTIONS.has(normalized.action);
}

function browserApprovalHash({ userId, taskId, command }) {
  const normalized = validateBrowserCommand(command);
  const payload = JSON.stringify({
    userId: String(userId),
    taskId: String(taskId),
    command: normalized
  });
  return crypto.createHash('sha256').update(payload).digest('hex');
}

function normalizePublicUrl(value) {
  let parsed;
  try { parsed = new URL(String(value)); } catch { throw new Error('URL non valido'); }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) throw new Error('Protocollo URL non consentito');
  if (parsed.username || parsed.password) throw new Error('Credenziali nell’URL non consentite');
  parsed.hash = '';
  return parsed.toString();
}

function normalizeSelector(value) {
  const selector = String(value).trim();
  if (!selector || selector.length > 500) throw new Error('Selettore non valido');
  return selector;
}

function normalizeFilename(value) {
  const filename = String(value).trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._ -]{0,199}$/.test(filename) || filename.includes('..')) {
    throw new Error('Nome file non valido');
  }
  return filename;
}

module.exports = { validateBrowserCommand, requiresBrowserApproval, browserApprovalHash };
