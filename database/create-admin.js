/** Create the first administrator from explicit one-time environment values. */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

async function createAdmin() {
  const email = String(process.env.ADMIN_EMAIL || '').trim().toLowerCase();
  const password = String(process.env.ADMIN_PASSWORD || '');
  const company = String(process.env.ADMIN_COMPANY || 'WES Administration').trim().slice(0, 120);
  if (!/^\S+@\S+\.\S+$/.test(email) || email.length > 254) throw new Error('ADMIN_EMAIL non è valida.');
  if (password.length < 12 || password.length > 128) throw new Error('ADMIN_PASSWORD deve contenere 12–128 caratteri.');
  if (company.length < 2) throw new Error('ADMIN_COMPANY non è valida.');

  const { initDatabase } = require('../app/config/database');
  const db = await initDatabase();
  const existing = db.prepare('SELECT id, role, status FROM users WHERE email = ?').get(email);
  if (existing) {
    if (existing.role === 'admin' && existing.status === 'active') {
      console.log('Amministratore già presente; nessuna credenziale è stata modificata.');
      return;
    }
    throw new Error('L’email appartiene già a un account non amministratore attivo.');
  }

  const bcrypt = require('bcryptjs');
  const { v4: uuidv4 } = require('uuid');
  db.prepare(`INSERT INTO users (id, email, password, company_name, sector, role, plan, status)
    VALUES (?, ?, ?, ?, 'Technology', 'admin', 'enterprise', 'active')`)
    .run(uuidv4(), email, bcrypt.hashSync(password, 12), company);
  console.log(`Amministratore creato: ${email}. La password non viene mostrata nei log.`);
}

createAdmin().catch((error) => {
  console.error(`Creazione amministratore non completata: ${error.message}`);
  process.exitCode = 1;
});
