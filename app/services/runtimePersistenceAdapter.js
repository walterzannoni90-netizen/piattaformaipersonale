'use strict';

const crypto = require('crypto');
const { parseSnapshot, currentStep, progress, mapStatus } = require('./taskStateStore');

const WAITING_CODES = new Set(['AI_NOT_CONFIGURED', 'WEB_NOT_CONFIGURED', 'CONNECTOR_NOT_CONFIGURED']);
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);

function clean(value, max = 4000) {
  return String(value || '').replace(/[\u0000-\u001F]/g, '').trim().slice(0, max);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(value) {
  return crypto.createHash('sha256').update(stableJson(value)).digest('hex');
}

function runtimeStatus(plan, event) {
  if (event?.type === 'approval_required') return 'waiting_approval';
  if (event?.code && WAITING_CODES.has(event.code)) return 'waiting_configuration';
  return mapStatus(plan.status);
}

function eventPresentation(event) {
  const step = event?.step || null;
  const title = clean(step?.title || event?.type || 'Runtime event', 180);
  const metadata = {
    runtimeEvent: event?.type || null,
    stepId: step?.id || null,
    tool: step?.tool || null,
    attempt: Number(event?.attempt || 0),
    code: event?.code || null,
    approvalHash: event?.approvalHash || null,
    resultFingerprint: event?.result === undefined ? null : fingerprint(event.result)
  };
  const messages = {
    execution_started: 'Esecuzione del piano avviata.',
    step_started: `Passaggio avviato${metadata.attempt ? ` · tentativo ${metadata.attempt}` : ''}.`,
    step_completed: 'Passaggio completato e checkpoint salvato.',
    step_retry_scheduled: `Nuovo tentativo pianificato${event?.error ? `: ${clean(event.error, 800)}` : '.'}`,
    step_failed: clean(event?.error || 'Passaggio non completato.', 1000),
    approval_required: 'In attesa di approvazione del payload esatto.',
    plan_replanned: `Piano correttivo creato · revisione ${Number(event?.replanCount || 0)}.`,
    execution_completed: 'Tutti i passaggi sono stati completati.',
    execution_failed: 'Il runtime ha terminato il piano con errore.',
    execution_cancelled: 'Esecuzione interrotta in sicurezza.'
  };
  const status = event?.type === 'step_failed' || event?.type === 'execution_failed'
    ? 'failed'
    : event?.type === 'approval_required'
      ? 'waiting'
      : event?.type === 'step_started' || event?.type === 'execution_started'
        ? 'running'
        : 'completed';
  return { title, detail: messages[event?.type] || clean(event?.error || event?.type || 'Evento runtime', 1000), status, metadata };
}

class RuntimePersistenceAdapter {
  constructor({ db, taskId, userId, eventWriter, now = () => new Date().toISOString() } = {}) {
    if (!db || typeof db.prepare !== 'function') throw new Error('Database obbligatorio');
    if (!taskId) throw new Error('Task id obbligatorio');
    this.db = db;
    this.taskId = String(taskId);
    this.userId = userId ? String(userId) : null;
    this.eventWriter = typeof eventWriter === 'function' ? eventWriter : null;
    this.now = now;
    this.lastSnapshotHash = null;
    this.deliveryClaimed = false;
  }

  assertOwnership() {
    if (!this.userId) return;
    const row = this.db.prepare('SELECT user_id FROM agent_tasks WHERE id = ?').get(this.taskId);
    if (!row || String(row.user_id) !== this.userId) throw new Error('Task non accessibile');
  }

  load() {
    this.assertOwnership();
    const row = this.db.prepare('SELECT plan FROM agent_tasks WHERE id = ?').get(this.taskId);
    return row?.plan ? parseSnapshot(row.plan) : null;
  }

  save(plan, event = null) {
    this.assertOwnership();
    const snapshot = parseSnapshot(plan);
    const serialized = JSON.stringify(snapshot);
    const snapshotHash = fingerprint(snapshot);
    const status = runtimeStatus(snapshot, event);
    const error = event?.type === 'step_failed' || event?.type === 'execution_failed'
      ? clean(event.error || 'Errore runtime', 1000)
      : event?.code && WAITING_CODES.has(event.code)
        ? clean(event.error || event.code, 1000)
        : null;
    const needsApproval = event?.type === 'approval_required' ? 1 : 0;
    this.db.prepare(`UPDATE agent_tasks
      SET plan = ?, current_step = ?, progress = ?, status = ?, error = ?, needs_approval = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`).run(
      serialized,
      currentStep(snapshot),
      progress(snapshot),
      status,
      error,
      needsApproval,
      this.taskId
    );
    if (snapshotHash !== this.lastSnapshotHash) {
      this.lastSnapshotHash = snapshotHash;
      this.writeEvent(event, snapshotHash);
    }
    return clone(snapshot);
  }

  writeEvent(event, snapshotHash) {
    if (!event || !this.eventWriter) return;
    const view = eventPresentation(event);
    this.eventWriter({
      taskId: this.taskId,
      type: clean(event.type, 80),
      title: view.title,
      detail: view.detail,
      status: view.status,
      metadata: { ...view.metadata, snapshotHash }
    });
  }

  checkpoint() {
    return async (plan, event) => this.save(plan, event);
  }

  onEvent() {
    return async (event) => {
      if (!event?.plan) return;
      this.save(event.plan, event);
    };
  }

  claimDelivery(plan) {
    const snapshot = parseSnapshot(plan);
    if (snapshot.status !== 'completed') return false;
    if (this.deliveryClaimed) return false;
    const row = this.db.prepare('SELECT completed_at FROM agent_tasks WHERE id = ?').get(this.taskId);
    if (row?.completed_at) return false;
    this.deliveryClaimed = true;
    return true;
  }

  completeDelivery({ result, creditsUsed = null } = {}) {
    if (!this.deliveryClaimed) throw new Error('Delivery non acquisita');
    const fields = ['status = ?', 'progress = 100', 'result = ?', 'error = NULL', 'needs_approval = 0', 'completed_at = ?', 'updated_at = CURRENT_TIMESTAMP'];
    const values = ['completed', clean(result, 2_000_000), this.now()];
    if (creditsUsed !== null) {
      fields.push('credits_used = ?');
      values.push(Math.max(0, Number(creditsUsed) || 0));
    }
    values.push(this.taskId);
    this.db.prepare(`UPDATE agent_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  }

  markCancelled(plan) {
    const snapshot = parseSnapshot(plan);
    snapshot.status = 'cancelled';
    for (const state of Object.values(snapshot.state)) {
      if (['pending', 'running'].includes(state.status)) state.status = 'cancelled';
    }
    this.db.prepare("UPDATE agent_tasks SET cancel_requested = 0, status = 'stopped', plan = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
      .run(JSON.stringify(snapshot), this.taskId);
    return snapshot;
  }

  isTerminal(plan) {
    return TERMINAL.has(parseSnapshot(plan).status);
  }
}

module.exports = {
  RuntimePersistenceAdapter,
  WAITING_CODES,
  stableJson,
  fingerprint,
  runtimeStatus,
  eventPresentation
};