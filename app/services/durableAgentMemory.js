'use strict';

const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

function checksum(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function safeKey(value) {
  const key = String(value || '').trim();
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(key)) throw new Error('Chiave memoria non valida');
  return key;
}

class DurableAgentMemory {
  constructor({ directory, maxEvents = 5000 } = {}) {
    if (!directory) throw new Error('Directory memoria obbligatoria');
    this.directory = path.resolve(directory);
    this.maxEvents = Math.max(100, Number(maxEvents) || 5000);
    this.locks = new Map();
  }

  async init() {
    await fs.mkdir(this.directory, { recursive: true });
    return this;
  }

  fileFor(key) {
    return path.join(this.directory, `${safeKey(key)}.json`);
  }

  async withLock(key, operation) {
    const normalized = safeKey(key);
    const previous = this.locks.get(normalized) || Promise.resolve();
    let release;
    const gate = new Promise((resolve) => { release = resolve; });
    const tail = previous.then(() => gate);
    this.locks.set(normalized, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(normalized) === tail) this.locks.delete(normalized);
    }
  }

  envelope(key, state, events = [], revision = 1) {
    const payload = {
      key: safeKey(key),
      revision,
      state: clone(state),
      events: clone(events).slice(-this.maxEvents),
      updatedAt: new Date().toISOString()
    };
    return { ...payload, checksum: checksum(payload) };
  }

  verify(envelope) {
    if (!envelope || typeof envelope !== 'object') throw new Error('Memoria non valida');
    const { checksum: expected, ...payload } = envelope;
    if (!expected || checksum(payload) !== expected) throw new Error('Memoria corrotta');
    return envelope;
  }

  async save(key, state, events = []) {
    await this.init();
    return this.withLock(key, async () => {
      const existing = await this.load(key, { allowMissing: true });
      const next = this.envelope(key, state, events, (existing?.revision || 0) + 1);
      const target = this.fileFor(key);
      const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temporary, target);
      return clone(next);
    });
  }

  async load(key, { allowMissing = false } = {}) {
    await this.init();
    try {
      const raw = await fs.readFile(this.fileFor(key), 'utf8');
      return clone(this.verify(JSON.parse(raw)));
    } catch (error) {
      if (allowMissing && error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async appendEvent(key, event, stateUpdater = null) {
    await this.init();
    return this.withLock(key, async () => {
      const current = await this.load(key, { allowMissing: true }) || this.envelope(key, {}, [], 0);
      const nextState = typeof stateUpdater === 'function'
        ? await stateUpdater(clone(current.state), clone(event))
        : current.state;
      const events = [...current.events, {
        ...clone(event),
        timestamp: event?.timestamp || new Date().toISOString()
      }].slice(-this.maxEvents);
      const next = this.envelope(key, nextState, events, current.revision + 1);
      const target = this.fileFor(key);
      const temporary = `${target}.${process.pid}.${Date.now()}.tmp`;
      await fs.writeFile(temporary, JSON.stringify(next, null, 2), { encoding: 'utf8', mode: 0o600 });
      await fs.rename(temporary, target);
      return clone(next);
    });
  }

  async checkpoint(key, execution) {
    return this.appendEvent(key, {
      type: 'checkpoint',
      status: execution?.status || 'running',
      progress: Number(execution?.progress) || 0
    }, () => ({ execution: clone(execution), resumable: true }));
  }

  async resume(key) {
    const memory = await this.load(key);
    if (!memory.state?.execution || memory.state.resumable !== true) throw new Error('Nessuna esecuzione ripristinabile');
    return clone(memory.state.execution);
  }

  async remove(key) {
    try {
      await fs.unlink(this.fileFor(key));
      return true;
    } catch (error) {
      if (error.code === 'ENOENT') return false;
      throw error;
    }
  }
}

module.exports = { DurableAgentMemory, checksum, safeKey };
