'use strict';

const { BrowserSessionManager } = require('./browserSession');
const { createDefaultRegistry } = require('./toolRegistry');

class BrowserRuntime {
  constructor({ driver, sessions = new BrowserSessionManager(), registry = createDefaultRegistry() } = {}) {
    if (!driver || typeof driver.execute !== 'function') throw new Error('Driver browser non valido');
    this.driver = driver;
    this.sessions = sessions;
    this.registry = registry;
  }

  createSession({ userId, taskId }) {
    return this.sessions.create({ userId, taskId });
  }

  async execute({ sessionId, userId, taskId, plan, agentRole, command, approvedPayloadHash = null }) {
    const prepared = this.sessions.prepareCommand({ sessionId, userId, taskId, command });
    const authorization = this.registry.authorize({
      toolId: 'browser.session',
      action: prepared.command.action,
      plan,
      agentRole,
      approvedPayloadHash
    });
    if (!authorization.allowed) {
      const error = new Error(`Comando browser non autorizzato: ${authorization.reason}`);
      error.code = authorization.reason;
      error.approvalHash = prepared.approvalRequired ? prepared.approvalHash : null;
      throw error;
    }
    if (prepared.approvalRequired && approvedPayloadHash !== prepared.approvalHash) {
      const error = new Error('Approvazione browser non valida o non riferita al comando corrente');
      error.code = 'approval_hash_mismatch';
      error.approvalHash = prepared.approvalHash;
      throw error;
    }

    try {
      const result = await this.driver.execute({
        sessionId: String(sessionId),
        userId: String(userId),
        taskId: String(taskId),
        command: prepared.command
      });
      this.sessions.recordCommand({
        sessionId,
        userId,
        command: prepared.command,
        status: 'completed',
        artifactId: result?.artifactId || null
      });
      return Object.freeze({ result, command: prepared.command });
    } catch (cause) {
      this.sessions.recordCommand({ sessionId, userId, command: prepared.command, status: 'failed' });
      const error = new Error(`Esecuzione browser non riuscita: ${cause?.message || 'errore sconosciuto'}`);
      error.code = 'browser_execution_failed';
      error.cause = cause;
      throw error;
    }
  }

  closeSession({ sessionId, userId }) {
    return this.sessions.close({ sessionId, userId });
  }
}

module.exports = { BrowserRuntime };
