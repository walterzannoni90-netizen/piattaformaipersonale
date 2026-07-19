'use strict';

const crypto = require('crypto');
const { spawn } = require('child_process');

class SemanticMemoryIndex {
  constructor(store, embed) { this.store = store; this.embed = embed; }
  async add(record) { const embedding = await this.embed(record.content); return this.store.upsert({ ...record, embedding }); }
  async search(query, limit = 8) {
    const q = await this.embed(query); const rows = await this.store.list();
    const cosine = (a,b) => { let d=0,aa=0,bb=0; for(let i=0;i<Math.min(a.length,b.length);i++){d+=a[i]*b[i];aa+=a[i]**2;bb+=b[i]**2;} return aa&&bb?d/(Math.sqrt(aa)*Math.sqrt(bb)):0; };
    return rows.map(r => ({ ...r, score: cosine(q, r.embedding || []) })).sort((a,b)=>b.score-a.score).slice(0,limit);
  }
}

class ProcessSandbox {
  constructor({ commandAllowlist = [], maxOutput = 200000 } = {}) { this.commandAllowlist = new Set(commandAllowlist); this.maxOutput = maxOutput; }
  async run(command, args = [], options = {}) {
    if (!this.commandAllowlist.has(command)) throw Object.assign(new Error('Comando non autorizzato'), { code: 'SANDBOX_DENIED' });
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { cwd: options.cwd, env: options.env || {}, shell: false, stdio: ['ignore','pipe','pipe'] });
      let stdout=''; let stderr=''; const timer=setTimeout(()=>{child.kill('SIGKILL'); reject(Object.assign(new Error('Timeout sandbox'),{code:'SANDBOX_TIMEOUT'}));}, options.timeoutMs || 30000);
      child.stdout.on('data', d => { stdout += d; if (stdout.length > this.maxOutput) child.kill('SIGKILL'); });
      child.stderr.on('data', d => { stderr += d; if (stderr.length > this.maxOutput) child.kill('SIGKILL'); });
      child.on('error', reject); child.on('close', code => { clearTimeout(timer); resolve({ code, stdout: stdout.slice(0,this.maxOutput), stderr: stderr.slice(0,this.maxOutput), passed: code===0 }); });
    });
  }
}

class SecurePluginRegistry {
  constructor({ trustedKeys = {}, permissions = [] } = {}) { this.trustedKeys = trustedKeys; this.permissions = new Set(permissions); this.plugins = new Map(); }
  verify(manifest, source, signature) {
    const key = this.trustedKeys[manifest.publisher]; if (!key) return false;
    return crypto.verify('sha256', Buffer.from(source), key, Buffer.from(signature, 'base64'));
  }
  register({ manifest, source, signature, handler }) {
    if (!manifest?.id || !manifest?.version || typeof handler !== 'function') throw new Error('Plugin non valido');
    if (!this.verify(manifest, source, signature)) throw Object.assign(new Error('Firma plugin non valida'), { code: 'PLUGIN_SIGNATURE_INVALID' });
    for (const permission of manifest.permissions || []) if (!this.permissions.has(permission)) throw Object.assign(new Error(`Permesso plugin negato: ${permission}`), { code: 'PLUGIN_PERMISSION_DENIED' });
    this.plugins.set(manifest.id, { manifest, handler, enabled: true }); return { id: manifest.id, version: manifest.version };
  }
  revoke(id) { const plugin=this.plugins.get(id); if(plugin) plugin.enabled=false; }
  get(id) { const plugin=this.plugins.get(id); return plugin?.enabled ? plugin : null; }
}

class RuntimeOptimizer {
  select({ candidates = [], budget = {} }) {
    const feasible = candidates.filter(c => (c.cost||0) <= (budget.cost ?? Infinity) && (c.tokens||0) <= (budget.tokens ?? Infinity) && (c.latencyMs||0) <= (budget.latencyMs ?? Infinity));
    feasible.sort((a,b) => this.score(b)-this.score(a)); return feasible[0] || null;
  }
  score(c) { return (c.quality||0) / Math.max(1,(c.cost||0)+(c.tokens||0)/1000+(c.latencyMs||0)/1000+(c.failureRate||0)*10); }
}

class ObservabilityStore {
  constructor(limit = 5000) { this.limit=limit; this.events=[]; }
  async record(event) { this.events.push({ ...event, at: event.at || new Date().toISOString() }); if(this.events.length>this.limit) this.events.splice(0,this.events.length-this.limit); }
  snapshot() {
    const failed=this.events.filter(e=>String(e.type).includes('failed')).length;
    return { events:this.events.length, failed, health: failed ? 'degraded':'healthy', recent:this.events.slice(-100) };
  }
}

function createAutomaticReplanner({ planner, verifier, maxRounds = 3 }) {
  return async function replan({ goal, plan, failure }) {
    let current = plan;
    for (let round=1; round<=maxRounds; round++) {
      current = await planner({ goal, previous: current, failure, round });
      const verification = await verifier({ goal, plan: current });
      if (verification.passed) return { plan: current, rounds: round, verification };
    }
    throw Object.assign(new Error('Replanning non verificato'), { code: 'REPLAN_EXHAUSTED' });
  };
}

function createSelfImprover({ memory, promptStore }) {
  return async ({ execution }) => {
    const lesson = { id: execution.id, failures: execution.failures || [], retries: execution.retries || 0, verification: execution.verification || null, at: new Date().toISOString() };
    await memory.appendEvent({ type:'learning.lesson', payload:lesson });
    if (execution.verification?.passed === false) await promptStore.propose({ reason:'verification_failed', constraints:lesson.failures });
    return lesson;
  };
}

module.exports = { SemanticMemoryIndex, ProcessSandbox, SecurePluginRegistry, RuntimeOptimizer, ObservabilityStore, createAutomaticReplanner, createSelfImprover };
