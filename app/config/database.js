const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const dbPath = path.resolve(__dirname, '../../', process.env.DB_PATH || './database/wes.db');
const dbDir = path.dirname(dbPath);

if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
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
    this._stmt.free();
    this._stmt = null;
    _saveDatabase();
    return { changes: this.db.getRowsModified() };
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
    try {
      fs.writeFileSync(dbPath, Buffer.from(_db.export()));
    } catch (e) {
      console.error('Failed to save database:', e.message);
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
  
  // Indexes
  db.exec('CREATE INDEX IF NOT EXISTS idx_leads_user ON leads(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_leads_status ON leads(status)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_conversations_user ON conversations(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_appointments_user ON appointments(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_followups_user ON follow_ups(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_automations_user ON automations(user_id)');
  db.exec('CREATE INDEX IF NOT EXISTS idx_logs_created ON logs(created_at)');
}

module.exports = { getDatabase, initDatabase };
