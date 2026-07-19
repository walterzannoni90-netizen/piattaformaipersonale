const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../config/database');

const PREFIX = 'enc:v1:';

function encryptionKey() {
  const source = process.env.APP_ENCRYPTION_KEY || process.env.JWT_SECRET;
  if (!source) throw new Error('APP_ENCRYPTION_KEY non configurata');
  return crypto.createHash('sha256').update(String(source)).digest();
}

function seal(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(String(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${Buffer.concat([iv, tag, ciphertext]).toString('base64url')}`;
}

function open(value) {
  const raw = String(value || '');
  if (!raw.startsWith(PREFIX)) return raw;
  const packed = Buffer.from(raw.slice(PREFIX.length), 'base64url');
  if (packed.length < 29) throw new Error('Segreto cifrato non valido');
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), packed.subarray(0, 12));
  decipher.setAuthTag(packed.subarray(12, 28));
  return Buffer.concat([decipher.update(packed.subarray(28)), decipher.final()]).toString('utf8');
}

function getSecret(userId, service) {
  const record = getDatabase().prepare('SELECT key_value FROM api_keys WHERE user_id = ? AND service = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1').get(userId, service);
  if (!record) return null;
  try { return open(record.key_value); } catch { return null; }
}

function hasSecret(userId, service) {
  return Boolean(getDatabase().prepare('SELECT id FROM api_keys WHERE user_id = ? AND service = ? AND is_active = 1 LIMIT 1').get(userId, service));
}

function setSecret(userId, service, value) {
  const db = getDatabase();
  const existing = db.prepare('SELECT id FROM api_keys WHERE user_id = ? AND service = ? ORDER BY created_at DESC LIMIT 1').get(userId, service);
  const encrypted = seal(value);
  if (existing) db.prepare('UPDATE api_keys SET key_value = ?, is_active = 1 WHERE id = ? AND user_id = ?').run(encrypted, existing.id, userId);
  else db.prepare('INSERT INTO api_keys (id, user_id, service, key_value, is_active) VALUES (?, ?, ?, ?, 1)').run(uuidv4(), userId, service, encrypted);
}

function removeSecret(userId, service) {
  getDatabase().prepare('UPDATE api_keys SET is_active = 0 WHERE user_id = ? AND service = ?').run(userId, service);
}

module.exports = { seal, open, getSecret, hasSecret, setSecret, removeSecret };
