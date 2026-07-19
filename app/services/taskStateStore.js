'use strict';

const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

function parseSnapshot(value) {
  if (!value) return null;
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!parsed || !parsed.id || !Array.isArray(parsed.steps) || !parsed.state) throw new Error('Snapshot piano non valido');
  return parsed;
}

function recoverInterrupted(snapshot) {
  const plan = parseSnapshot(snapshot);
  if (!plan || TERMINAL.has(plan.status)) return plan;
  for (const step of plan.steps) {
    const current = plan.state[step.id];
    if (current?.status === 'running') {
      current.status = 'pending';
      current.error = 'Esecuzione interrotta: step ripristinato dopo riavvio';
      current.startedAt = null;
    }
  }
  plan.status = 'pending';
  plan.updatedAt = new Date().toISOString();
  plan.metadata = { ...(plan.metadata || {}), recoveredAt: plan.updatedAt };
  return plan;
}

class TaskStateStore {
  constructor({ db, table = 'agent_tasks' } = {}) {
    if (!db || typeof db.prepare !== 'function') throw new Error('Database obbligatorio');
    if (!/^[a-z_][a-z0-9_]*$/i.test(table)) throw new Error('Tabella non valida');
    this.db = db;
    this.table = table;
  }

  save(taskId, plan) {
    const snapshot = parseSnapshot(plan);
    const serialized = JSON.stringify(snapshot);
    this.db.prepare(`UPDATE ${this.table} SET plan = ?, current_step = ?, progress = ?, status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(
      serialized,
      currentStep(snapshot),
      progress(snapshot),
      mapStatus(snapshot.status),
      String(taskId)
    );
    return snapshot;
  }

  load(taskId, { recover = true } = {}) {
    const row = this.db.prepare(`SELECT plan FROM ${this.table} WHERE id = ?`).get(String(taskId));
    if (!row?.plan) return null;
    const snapshot = recover ? recoverInterrupted(row.plan) : parseSnapshot(row.plan);
    if (recover && snapshot && !TERMINAL.has(snapshot.status)) this.save(taskId, snapshot);
    return snapshot;
  }

  createStateChangeHandler(taskId, downstream) {
    return async (event) => {
      this.save(taskId, event.plan);
      if (typeof downstream === 'function') await downstream(event);
    };
  }
}

function currentStep(plan) {
  const running = plan.steps.find((step) => plan.state[step.id]?.status === 'running');
  if (running) return running.title;
  const pending = plan.steps.find((step) => plan.state[step.id]?.status === 'pending');
  return pending ? pending.title : null;
}

function progress(plan) {
  const total = plan.steps.length || 1;
  const completed = plan.steps.filter((step) => plan.state[step.id]?.status === 'completed').length;
  return Math.round((completed / total) * 100);
}

function mapStatus(status) {
  if (status === 'cancelled') return 'stopped';
  return ['pending', 'running', 'completed', 'failed'].includes(status) ? status : 'pending';
}

module.exports = { TaskStateStore, parseSnapshot, recoverInterrupted, currentStep, progress, mapStatus };
