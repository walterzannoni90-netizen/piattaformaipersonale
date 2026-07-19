const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../config/database');

let timer = null;

function retentionDays() {
  const value = Number(process.env.DATA_RETENTION_DAYS || 365);
  return Number.isInteger(value) && value >= 30 && value <= 3650 ? value : 365;
}

function cleanup() {
  const db = getDatabase();
  const modifier = `-${retentionDays()} days`;
  const resets = db.prepare("DELETE FROM password_reset_tokens WHERE used_at IS NOT NULL OR datetime(expires_at) < datetime('now', '-1 day')").run().changes;
  const logs = db.prepare("DELETE FROM logs WHERE datetime(created_at) < datetime('now', ?)").run(modifier).changes;
  const inbound = db.prepare("DELETE FROM inbound_requests WHERE datetime(created_at) < datetime('now', ?)").run(modifier).changes;
  const webhooks = db.prepare("DELETE FROM processed_webhook_events WHERE datetime(created_at) < datetime('now', ?)").run(modifier).changes;
  if (resets || logs || inbound || webhooks) {
    db.prepare(`INSERT INTO logs (id, level, action, details) VALUES (?, 'info', 'retention_cleanup', ?)`)
      .run(uuidv4(), JSON.stringify({ password_reset_tokens: resets, logs, inbound_requests: inbound, webhook_events: webhooks }));
  }
  return { resets, logs, inbound, webhooks };
}

function start() {
  if (timer) return;
  cleanup();
  timer = setInterval(() => {
    try { cleanup(); } catch (error) { console.error('Data retention cleanup:', error.message); }
  }, 24 * 60 * 60 * 1000);
  timer.unref?.();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, cleanup, retentionDays };
