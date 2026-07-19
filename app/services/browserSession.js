'use strict';

const crypto = require('crypto');
const { validateBrowserCommand, requiresBrowserApproval, browserApprovalHash } = require('./browserPolicy');

class BrowserSessionManager {
  constructor({ maxSessionsPerUser = 2, sessionTtlMs = 15 * 60 * 1000, clock = Date.now } = {}) {
    this.maxSessionsPerUser = Math.max(1, Math.min(Number(maxSessionsPerUser) || 2, 5));
    this.sessionTtlMs = Math.max(60_000, Math.min(Number(sessionTtlMs) || 900_000, 3_600_000));
    if (typeof clock !== 'function') throw new Error('Clock non valido');
    this.clock = clock;
    this.sessions = new Map();
  }

  now() {
    return Number(this.clock());
  }

  create({ userId, taskId }) {
    const normalizedUserId = String(userId);
    const now = this.now();
    const active = [...this.sessions.values()].filter((session) => {
      if (session.userId !== normalizedUserId || session.closedAt) return false;
      if (session.expiresAt <= now) {
        session.closedAt = now;
        return false;
      }
      return true;
    });
    if (active.length >= this.maxSessionsPerUser) throw new Error('Limite sessioni browser raggiunto');

    const session = {
      id: crypto.randomUUID(),
      userId: normalizedUserId,
      taskId: String(taskId),
      createdAt: now,
      expiresAt: now + this.sessionTtlMs,
      closedAt: null,
      commands: []
    };
    this.sessions.set(session.id, session);
    return snapshot(session);
  }

  get({ sessionId, userId }) {
    const session = this.sessions.get(String(sessionId));
    if (!session || session.userId !== String(userId)) return null;
    const now = this.now();
    if (!session.closedAt && session.expiresAt <= now) session.closedAt = now;
    return snapshot(session);
  }

  prepareCommand({ sessionId, userId, taskId, command }) {
    const session = this.sessions.get(String(sessionId));
    if (!session || session.userId !== String(userId) || session.taskId !== String(taskId)) {
      throw new Error('Sessione browser non disponibile');
    }
    if (session.closedAt || session.expiresAt <= this.now()) throw new Error('Sessione browser scaduta');

    const normalized = validateBrowserCommand(command);
    const approvalRequired = requiresBrowserApproval(normalized);
    const approvalHash = browserApprovalHash({ userId, taskId, command: normalized });
    return Object.freeze({ command: normalized, approvalRequired, approvalHash });
  }

  recordCommand({ sessionId, userId, command, status, artifactId = null }) {
    const session = this.sessions.get(String(sessionId));
    if (!session || session.userId !== String(userId)) throw new Error('Sessione browser non disponibile');
    const now = this.now();
    if (session.closedAt || session.expiresAt <= now) throw new Error('Sessione browser scaduta');
    session.commands.push(Object.freeze({
      at: now,
      action: String(command.action),
      status: String(status),
      artifactId: artifactId == null ? null : String(artifactId)
    }));
    if (session.commands.length > 200) session.commands.splice(0, session.commands.length - 200);
    return snapshot(session);
  }

  close({ sessionId, userId }) {
    const session = this.sessions.get(String(sessionId));
    if (!session || session.userId !== String(userId)) return false;
    session.closedAt = session.closedAt || this.now();
    return true;
  }

  cleanup(now = this.now()) {
    let removed = 0;
    for (const [id, session] of this.sessions) {
      if ((session.closedAt || session.expiresAt) + this.sessionTtlMs <= now) {
        this.sessions.delete(id);
        removed += 1;
      }
    }
    return removed;
  }
}

function snapshot(session) {
  return Object.freeze({
    id: session.id,
    userId: session.userId,
    taskId: session.taskId,
    createdAt: session.createdAt,
    expiresAt: session.expiresAt,
    closedAt: session.closedAt,
    commands: session.commands.map((entry) => ({ ...entry }))
  });
}

module.exports = { BrowserSessionManager };
