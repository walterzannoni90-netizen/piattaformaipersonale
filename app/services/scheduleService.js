const { Cron } = require('croner');
const { v4: uuidv4 } = require('uuid');
const { getDatabase } = require('../config/database');
const orchestrator = require('./agentOrchestrator');

let timer = null;
let processing = false;
const TASK_LIMITS = Object.freeze({
  starter: { active: 2, daily: 20 },
  pro: { active: 5, daily: 100 },
  enterprise: { active: 10, daily: 500 }
});

function taskQuotaError(db, userId) {
  const user = db.prepare('SELECT plan FROM users WHERE id = ? AND status = ?').get(userId, 'active');
  if (!user) return 'Account non attivo.';
  const limit = TASK_LIMITS[user.plan] || TASK_LIMITS.starter;
  const active = Number(db.prepare("SELECT COUNT(*) AS count FROM agent_tasks WHERE user_id = ? AND status IN ('planning','running','waiting_approval')").get(userId).count);
  const createdToday = Number(db.prepare("SELECT COUNT(*) AS count FROM agent_tasks WHERE user_id = ? AND date(created_at) = date('now')").get(userId).count);
  if (active >= limit.active) return `Limite di ${limit.active} task attivi raggiunto.`;
  if (createdToday >= limit.daily) return `Limite giornaliero di ${limit.daily} task raggiunto.`;
  return null;
}

function nextRun(cronExpression, timezone, after = new Date()) {
  const cron = new Cron(cronExpression, { timezone, paused: true });
  return cron.nextRun(after);
}

function initializeNextRuns() {
  const db = getDatabase();
  const schedules = db.prepare('SELECT * FROM task_schedules WHERE is_active = 1 AND next_run IS NULL').all();
  for (const schedule of schedules) {
    try {
      const next = nextRun(schedule.cron_expression, schedule.timezone);
      db.prepare('UPDATE task_schedules SET next_run = ? WHERE id = ?').run(next?.toISOString() || null, schedule.id);
    } catch {
      db.prepare('UPDATE task_schedules SET is_active = 0 WHERE id = ?').run(schedule.id);
    }
  }
}

async function processDueSchedules() {
  if (processing) return;
  processing = true;
  try {
    const db = getDatabase();
    const due = db.prepare("SELECT * FROM task_schedules WHERE is_active = 1 AND next_run IS NOT NULL AND datetime(next_run) <= datetime('now') ORDER BY next_run ASC LIMIT 20").all();
    for (const schedule of due) {
      const next = nextRun(schedule.cron_expression, schedule.timezone, new Date(Date.now() + 60_000));
      db.prepare('UPDATE task_schedules SET last_run = CURRENT_TIMESTAMP, next_run = ? WHERE id = ? AND user_id = ?')
        .run(next?.toISOString() || null, schedule.id, schedule.user_id);
      const quotaError = taskQuotaError(db, schedule.user_id);
      if (quotaError) {
        db.prepare('INSERT INTO logs (id, user_id, level, action, details) VALUES (?, ?, ?, ?, ?)')
          .run(uuidv4(), schedule.user_id, 'warning', 'scheduled_task_skipped', JSON.stringify({ scheduleId: schedule.id, reason: quotaError }));
        continue;
      }
      const id = uuidv4();
      db.prepare(`INSERT INTO agent_tasks (id, user_id, project_id, title, prompt, status, progress, plan)
        VALUES (?, ?, ?, ?, ?, 'planning', 1, '[]')`).run(id, schedule.user_id, schedule.project_id || null, schedule.name, schedule.prompt);
      db.prepare('INSERT INTO task_events (id, task_id, type, title, detail, status) VALUES (?, ?, ?, ?, ?, ?)')
        .run(uuidv4(), id, 'schedule', 'Task avviato da pianificazione', schedule.name, 'completed');
      orchestrator.startTask(id);
    }
  } finally {
    processing = false;
  }
}

function start() {
  if (timer) return;
  initializeNextRuns();
  timer = setInterval(() => processDueSchedules().catch((error) => console.error('Schedule processor:', error.message)), 30_000);
  timer.unref?.();
}

function stop() {
  if (timer) clearInterval(timer);
  timer = null;
}

module.exports = { start, stop, nextRun, processDueSchedules, taskQuotaError, TASK_LIMITS };
