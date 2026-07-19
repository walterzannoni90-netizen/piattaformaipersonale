'use strict';

const { getDatabase } = require('../config/database');
const { parseSnapshot, recoverInterrupted, currentStep, progress, mapStatus } = require('./taskStateStore');

function isSnapshotPlan(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    return Boolean(parsed && parsed.id && Array.isArray(parsed.steps) && parsed.state);
  } catch {
    return false;
  }
}

function flattenSnapshot(snapshot) {
  const recovered = recoverInterrupted(parseSnapshot(snapshot));
  return {
    plan: JSON.stringify(recovered.steps.map((step) => ({
      id: step.id,
      title: step.title,
      description: step.description || '',
      tool: step.tool,
      input: step.input || {},
      dependsOn: step.dependsOn || [],
      maxAttempts: step.maxAttempts,
      approvalRequired: step.approvalRequired === true
    }))),
    currentStep: currentStep(recovered),
    progress: progress(recovered),
    status: mapStatus(recovered.status),
    snapshot: recovered
  };
}

function prepareRecoverableTasks(db = getDatabase(), { limit = 100 } = {}) {
  const rows = db.prepare("SELECT id, plan, status, cancel_requested FROM agent_tasks WHERE status IN ('pending','planning','running') AND cancel_requested = 0 ORDER BY created_at ASC LIMIT ?").all(Math.max(1, Math.min(Number(limit) || 100, 1000)));
  let converted = 0;
  let invalid = 0;
  for (const row of rows) {
    if (!isSnapshotPlan(row.plan)) continue;
    try {
      const restored = flattenSnapshot(row.plan);
      db.prepare("UPDATE agent_tasks SET plan = ?, current_step = ?, progress = ?, status = ?, error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(restored.plan, restored.currentStep, restored.progress, restored.status === 'pending' ? 'running' : restored.status, row.id);
      converted += 1;
    } catch (error) {
      db.prepare("UPDATE agent_tasks SET status = 'failed', error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(`Snapshot non recuperabile: ${String(error.message || error).slice(0, 800)}`, row.id);
      invalid += 1;
    }
  }
  return { scanned: rows.length, converted, invalid };
}

if (process.env.NODE_ENV !== 'test') {
  try {
    prepareRecoverableTasks();
  } catch (error) {
    console.error('Task recovery bootstrap failed:', error.message);
  }
}

module.exports = { isSnapshotPlan, flattenSnapshot, prepareRecoverableTasks };
