const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const dbPath = path.resolve(__dirname, '../../', process.env.DB_PATH || './database/wes.db');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true, mode: 0o700 });
}

let _db = null;
let SQL = null;
let initialized = false;
let initPromise = null;

// Compatibility wrapper to emulate better-sqlite3 API
class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this._stmt = null;
  }

  _prepare() {
    try {
      this._stmt = this.db.prepare(this.sql);
    } catch (e) {
      console.error(`SQL prepare error: ${this.sql}`, e.message);
      throw e;
    }
  }

  bind(...params) {
    if (!this._stmt) this._prepare();
    try {
      // Flatten params if first is array
      const flatParams = params.length === 1 && Array.isArray(params[0]) ? params[0] : params;
      this._stmt.bind(flatParams);
    } catch (e) {
      console.error(`SQL bind error: ${this.sql}`, e.message, params);
      throw e;
    }
    return this;
  }

  run(...params) {
    if (!this._stmt) this._prepare();
    this.bind(...params);
    this._stmt.step();
    // sql.js resets its modified-row counter during export(). Capture it before
    // persisting the database or callers would receive a false zero even though
    // the write was applied.
    const changes = this.db.getRowsModified();
    this._stmt.free();
    this._stmt = null;
    _saveDatabase();
    return { changes };
  }

  get(...params) {
    if (!this._stmt) this._prepare();
    this.bind(...params);
    const result = this._stmt.step() ? this._stmt.getAsObject() : undefined;
    this._stmt.free();
    this._stmt = null;
    return result;
  }

  all(...params) {
    if (!this._stmt) this._prepare();
    this.bind(...params);
    const results = [];
    while (this._stmt.step()) {
      results.push(this._stmt.getAsObject());
    }
    this._stmt.free();
    this._stmt = null;
    return results;
  }

  iterate(...params) {
    return this.all(...params)[Symbol.iterator]();
  }
}

class DatabaseCompat {
  constructor() {
    this._db = null;
  }

  prepare(sql) {
    return new Statement(this._db, sql);
  }

  run(sql, params = {}) {
    // Support named params as object
    try {
      const stmt = this._db.prepare(sql);
      stmt.bind(params);
      stmt.step();
      stmt.free();
      _saveDatabase();
    } catch (e) {
      console.error(`SQL run error: ${sql}`, e.message, params);
      throw e;
    }
  }

  exec(sql) {
    this._db.run(sql);
    _saveDatabase();
  }

  // Initialize the internal db
  _init(sqlDb) {
    this._db = sqlDb;
  }
}

let db = new DatabaseCompat();

function _saveDatabase() {
  if (_db) {
    const temporaryPath = `${dbPath}.tmp-${process.pid}`;
    try {
      fs.writeFileSync(temporaryPath, Buffer.from(_db.export()), { mode: 0o600 });
      fs.renameSync(temporaryPath, dbPath);
      try { fs.chmodSync(dbPath, 0o600); } catch {}
    } catch (error) {
      try { if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath); } catch {}
      throw new Error(`Persistenza database non riuscita: ${error.message}`);
    }
  }
}

function getDatabase() {
  if (initialized) return db;
  // If init is in progress, we have a problem - callers should use initDatabase() first
  throw new Error('Database not initialized. Call initDatabase() first.');
}

async function initDatabase() {
  if (initialized) return db;
  if (initPromise) return initPromise;
  
  initPromise = (async () => {
    SQL = await initSqlJs();
    
    if (fs.existsSync(dbPath)) {
      const buffer = fs.readFileSync(dbPath);
      _db = new SQL.Database(buffer);
    } else {
      _db = new SQL.Database();
    }
    
    _db.run('PRAGMA foreign_keys = ON');
    db._init(_db);
    
    initializeSchema();
    _saveDatabase();
    initialized = true;
    
    return db;
  })();
  
  return initPromise;
}

function initializeSchema() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      company_name TEXT NOT NULL,
      sector TEXT,
      phone TEXT,
      role TEXT DEFAULT 'client',
      plan TEXT DEFAULT 'starter',
      setup_fee_paid INTEGER DEFAULT 0,
      status TEXT DEFAULT 'active',
      session_version INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      last_login TEXT,
      settings TEXT DEFAULT '{}'
    )
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      service TEXT NOT NULL,
      key_value TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      token_hash TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      used_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL DEFAULT 'Agente Principale',
      tone TEXT DEFAULT 'professionale',
      welcome_message TEXT DEFAULT 'Ciao! Sono l''assistente virtuale di [azienda]. Come posso aiutarti oggi?',
      qualification_questions TEXT DEFAULT '[]',
      transfer_conditions TEXT DEFAULT '{}',
      is_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS leads (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT,
      email TEXT,
      phone TEXT,
      phone_normalized TEXT,
      source TEXT,
      status TEXT DEFAULT 'new',
      score INTEGER DEFAULT 0,
      notes TEXT,
      custom_fields TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      first_contact TEXT,
      last_contact TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      lead_id TEXT,
      agent_id TEXT,
      channel TEXT DEFAULT 'whatsapp',
      status TEXT DEFAULT 'active',
      messages TEXT DEFAULT '[]',
      summary TEXT,
      sentiment TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL,
      FOREIGN KEY (agent_id) REFERENCES agents(id) ON DELETE SET NULL
    )
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS appointments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      lead_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT DEFAULT 'scheduled',
      calendar_event_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
    )
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS follow_ups (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      lead_id TEXT,
      type TEXT NOT NULL,
      delay_hours INTEGER NOT NULL,
      message_template TEXT,
      scheduled_at TEXT NOT NULL,
      executed_at TEXT,
      status TEXT DEFAULT 'pending',
      channel TEXT DEFAULT 'whatsapp',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
    )
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      trigger_event TEXT NOT NULL,
      actions TEXT DEFAULT '[]',
      conditions TEXT DEFAULT '{}',
      is_active INTEGER DEFAULT 1,
      last_run TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS invoices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      lead_id TEXT,
      invoice_number TEXT UNIQUE,
      amount REAL NOT NULL,
      status TEXT DEFAULT 'draft',
      items TEXT DEFAULT '[]',
      notes TEXT,
      sent_at TEXT,
      paid_at TEXT,
      stripe_invoice_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (lead_id) REFERENCES leads(id) ON DELETE SET NULL
    )
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS subscriptions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL UNIQUE,
      plan TEXT NOT NULL,
      status TEXT DEFAULT 'active',
      current_period_start TEXT,
      current_period_end TEXT,
      stripe_subscription_id TEXT,
      stripe_customer_id TEXT,
      stripe_event_created INTEGER DEFAULT 0,
      trial_end TEXT,
      cancelled_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_stats (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      date TEXT NOT NULL,
      conversations_count INTEGER DEFAULT 0,
      leads_count INTEGER DEFAULT 0,
      messages_count INTEGER DEFAULT 0,
      follow_ups_sent INTEGER DEFAULT 0,
      appointments_scheduled INTEGER DEFAULT 0,
      api_calls INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, date)
    )
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS logs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      level TEXT DEFAULT 'info',
      action TEXT NOT NULL,
      details TEXT,
      ip_address TEXT,
      user_agent TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS webhooks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      url TEXT NOT NULL,
      events TEXT DEFAULT '[]',
      secret TEXT,
      is_active INTEGER DEFAULT 1,
      last_triggered TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);
  
  db.exec(`
    CREATE TABLE IF NOT EXISTS integrations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      service TEXT NOT NULL,
      is_connected INTEGER DEFAULT 0,
      credentials TEXT DEFAULT '{}',
      last_sync TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      UNIQUE(user_id, service)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS inbound_requests (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT,
      company TEXT,
      message TEXT,
      requested_at TEXT,
      status TEXT DEFAULT 'new',
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS processed_webhook_events (
      provider TEXT NOT NULL,
      event_id TEXT NOT NULL,
      event_type TEXT,
      user_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      PRIMARY KEY (provider, event_id)
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_tasks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      status TEXT DEFAULT 'planning',
      progress INTEGER DEFAULT 0,
      current_step INTEGER DEFAULT 0,
      mode TEXT DEFAULT 'autonomous',
      plan TEXT DEFAULT '[]',
      result TEXT,
      error TEXT,
      needs_approval INTEGER DEFAULT 0,
      cancel_requested INTEGER DEFAULT 0,
      credits_used INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      completed_at TEXT,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_events (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      type TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      status TEXT DEFAULT 'completed',
      metadata TEXT DEFAULT '{}',
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_artifacts (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      content TEXT,
      url TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      instructions TEXT,
      color TEXT DEFAULT '#6C63FF',
      archived INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS project_memories (
      id TEXT PRIMARY KEY,
      project_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      kind TEXT DEFAULT 'fact',
      content TEXT NOT NULL,
      source_task_id TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (source_task_id) REFERENCES agent_tasks(id) ON DELETE SET NULL
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS workspace_files (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      task_id TEXT,
      original_name TEXT NOT NULL,
      stored_name TEXT NOT NULL,
      mime_type TEXT NOT NULL,
      size_bytes INTEGER NOT NULL,
      storage_path TEXT NOT NULL,
      sha256 TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_approvals (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      action_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT,
      payload TEXT DEFAULT '{}',
      status TEXT DEFAULT 'pending',
      decided_at TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_messages (
      id TEXT PRIMARY KEY,
      task_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (task_id) REFERENCES agent_tasks(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    )
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS task_schedules (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_id TEXT,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      mode TEXT DEFAULT 'autonomous',
      cron_expression TEXT NOT NULL,
      timezone TEXT DEFAULT 'Europe/Rome',
      is_active INTEGER DEFAULT 1,
      last_run TEXT,
      next_run TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE SET NULL
    )
  `);

  // Forward-only, non-destructive migrations for installations created before
  // the autonomous workspace was introduced.
  const userColumns = db.prepare('PRAGMA table_info(users)').all().map((column) => column.name);
  if (!userColumns.includes('session_version')) db.exec('ALTER TABLE users ADD COLUMN session_version INTEGER DEFAULT 0');

  const taskColumns = db.prepare('PRAGMA table_info(agent_tasks)').all().map((column) => column.name);
  const addTaskColumn = (name, definition) => {
    if (!taskColumns.includes(name)) db.exec(`ALTER TABLE agent_tasks ADD COLUMN ${name} ${definition}`);
  };
  addTaskColumn('project_id', 'TEXT');
  addTaskColumn('current_step', 'INTEGER DEFAULT 0');
  addTaskColumn('error', 'TEXT');
  addTaskColumn('needs_approval', 'INTEGER DEFAULT 0');
  addTaskColumn('cancel_requested', 'INTEGER DEFAULT 0');

  const scheduleColumns = db.prepare('PRAGMA table_info(task_schedules)').all().map((column) => column.name);
  if (!scheduleColumns.includes('mode')) db.exec("ALTER TABLE task_schedules ADD COLUMN mode TEXT DEFAULT 'autonomous'");

  const leadColumns = db.prepare('PRAGMA table_info(leads)').all().map((column) => column.name);
  if (!leadColumns.includes('phone_normalized')) db.exec('ALTER TABLE leads ADD COLUMN phone_normalized TEXT');
  const { normalizePhone } = require('../utils/contact');
  for (const lead of db.prepare("SELECT id, phone FROM leads WHERE phone IS NOT NULL AND trim(phone) <> '' AND (phone_normalized IS NULL OR phone_normalized = '')").all()) {
    db.prepare('UPDATE leads SET phone_normalized = ? WHERE id = ?').run(normalizePhone(lead.phone) || null, lead.id);
  }

  const subscriptionColumns = db.prepare('PRAGMA table_info(subscriptions)').all().map((column) => column.name);
  if (!subscriptionColumns.includes('stripe_event_created')) db.exec('ALTER TABLE subscriptions ADD COLUMN stripe_event_created INTEGER DEFAULT 0');

  // Normalize automation templates created by early versions, where the
  // template id was mistakenly stored instead of the runtime event name.
  const automationEvents = {
    'auto-response': 'first_message',
    'qualify-lead': 'first_message',
    'save-crm': 'lead_qualified',
    'auto-appointment': 'lead_qualified',
    'followup-1day': 'first_message',
    'followup-3days': 'first_message',
    'notify-sales': 'lead_qualified',
    'weekly-report': 'weekly_schedule'
  };
  for (const [legacy, event] of Object.entries(automationEvents)) {
    db.prepare('UPDATE automations SET trigger_event = ? WHERE trigger_event = ?').run(event, legacy);
  }
  db.prepare("UPDATE automations SET actions = '[\"send_followup_3days\"]' WHERE trigger_event = 'first_message' AND name = 'Follow-up dopo 3 giorni'").run();
  
  // Indexes
  db.exec('CREATE INDEX IF NOT EXISTS idx_leads_user ON leads(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_leads_user_status_created ON leads(user_id, status, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_leads_user_phone ON leads(user_id, phone_normalized)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_appointments_user ON appointments(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_appointments_user_time ON appointments(user_id, status, start_time, end_time)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_followups_user ON follow_ups(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_followups_due ON follow_ups(status, scheduled_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_automations_user ON automations(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_automations_trigger_user ON automations(trigger_event, user_id, is_active)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_logs_user_created ON logs(user_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_agent_tasks_user ON agent_tasks(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_agent_tasks_user_status_created ON agent_tasks(user_id, status, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_task_events_task ON task_events(task_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_task_events_task_created ON task_events(task_id, created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_projects_user ON projects(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_memories_project ON project_memories(project_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_workspace_files_user ON workspace_files(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_approvals_task ON task_approvals(task_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_approvals_task_status ON task_approvals(task_id, user_id, status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_inbound_requests_created ON inbound_requests(created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_webhook_events_created ON processed_webhook_events(created_at)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_task_schedules_due ON task_schedules(is_active, next_run)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_password_reset_hash ON password_reset_tokens(token_hash)');
}

module.exports = { getDatabase, initDatabase };
