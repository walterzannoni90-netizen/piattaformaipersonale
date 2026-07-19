/**
 * Initialize the WES schema and, only when explicitly requested, create a
 * development demo tenant. No default administrator or shared password is
 * ever created.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

module.exports = async function setupDatabase(options = {}) {
  const seedDemo = options.seedDemo ?? process.env.SEED_DEMO_DATA === 'true';
  console.log('Inizializzazione database WES…');

  const { initDatabase } = require('../app/config/database');
  const db = await initDatabase();
  if (!seedDemo) {
    console.log('Schema pronto. Nessun dato demo inserito.');
    return { initialized: true, seeded: false };
  }
  if (process.env.NODE_ENV === 'production') throw new Error('Il seed demo è vietato in produzione.');

  const existing = Number(db.prepare('SELECT COUNT(*) AS count FROM users').get().count);
  if (existing > 0) {
    console.log('Database già popolato. Seed demo ignorato.');
    return { initialized: true, seeded: false };
  }

  const password = String(process.env.DEMO_PASSWORD || '');
  if (password.length < 10 || password.length > 128) {
    throw new Error('Per il seed demo imposta DEMO_PASSWORD con 10–128 caratteri.');
  }

  const bcrypt = require('bcryptjs');
  const { v4: uuidv4 } = require('uuid');
  const clientId = uuidv4();
  const agentId = uuidv4();
  const firstLeadId = uuidv4();
  const secondLeadId = uuidv4();
  const email = String(process.env.DEMO_EMAIL || 'demo@azienda.test').trim().toLowerCase();
  const company = String(process.env.DEMO_COMPANY || 'Azienda Demo').trim().slice(0, 120);

  db.prepare(`INSERT INTO users (id, email, password, company_name, sector, role, plan)
    VALUES (?, ?, ?, ?, 'Servizi', 'client', 'pro')`)
    .run(clientId, email, bcrypt.hashSync(password, 12), company);
  db.prepare(`INSERT INTO agents (id, user_id, name, tone, welcome_message, qualification_questions, transfer_conditions)
    VALUES (?, ?, ?, 'professionale', ?, ?, ?)`)
    .run(agentId, clientId, 'Agente WES', `Ciao! Sono l’assistente virtuale di ${company}. Come posso aiutarti oggi?`,
      JSON.stringify([{ question: 'Quale risultato vuoi ottenere?', required: true }]),
      JSON.stringify({ min_score: 7, has_email: true, has_phone: true }));

  db.prepare(`INSERT INTO leads (id, user_id, name, email, phone, phone_normalized, source, status, score)
    VALUES (?, ?, 'Mario Rossi', 'mario@example.test', '+393331234567', '393331234567', 'whatsapp', 'qualified', 8)`)
    .run(firstLeadId, clientId);
  db.prepare(`INSERT INTO leads (id, user_id, name, email, phone, phone_normalized, source, status, score)
    VALUES (?, ?, 'Laura Bianchi', 'laura@example.test', '+393337654321', '393337654321', 'website', 'new', 3)`)
    .run(secondLeadId, clientId);
  db.prepare(`INSERT INTO conversations (id, user_id, lead_id, agent_id, channel, messages, status)
    VALUES (?, ?, ?, ?, 'whatsapp', ?, 'active')`)
    .run(uuidv4(), clientId, firstLeadId, agentId, JSON.stringify([
      { role: 'lead', content: 'Buongiorno, vorrei informazioni sui vostri servizi.', timestamp: new Date().toISOString() },
      { role: 'agent', content: 'Buongiorno! Quale risultato vuoi ottenere?', timestamp: new Date().toISOString() }
    ]));
  db.prepare(`INSERT INTO automations (id, user_id, name, trigger_event, actions, is_active)
    VALUES (?, ?, 'Accoglienza nuovi lead', 'first_message', '["send_welcome"]', 1)`)
    .run(uuidv4(), clientId);

  const start = new Date(Date.now() + 24 * 60 * 60 * 1000);
  start.setUTCHours(9, 0, 0, 0);
  const end = new Date(start.getTime() + 30 * 60 * 1000);
  db.prepare(`INSERT INTO appointments (id, user_id, lead_id, title, description, start_time, end_time, status)
    VALUES (?, ?, ?, 'Call dimostrativa', 'Dati sintetici per sviluppo locale', ?, ?, 'scheduled')`)
    .run(uuidv4(), clientId, firstLeadId, start.toISOString(), end.toISOString());

  console.log(`Tenant demo creato per ${email}. La password non viene mostrata nei log.`);
  return { initialized: true, seeded: true, userId: clientId };
};

if (require.main === module) {
  module.exports().catch((error) => {
    console.error(`Setup non completato: ${error.message}`);
    process.exitCode = 1;
  });
}
