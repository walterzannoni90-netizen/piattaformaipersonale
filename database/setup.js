/**
 * NUMMY - Database Setup Script
 * Run: node database/setup.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const path = require('path');
const crypto = require('crypto');

module.exports = async function setupDatabase() {
  console.log('🔄 Inizializzazione database NUMMY...');
  
  try {
    const { initDatabase } = require('../app/config/database');
    const db = await initDatabase();
    
    // Check if we need demo data
    const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
    
    if (userCount.count === 0) {
      console.log('📦 Inserimento dati demo...');
      
      const bcrypt = require('bcryptjs');
      const { v4: uuidv4 } = require('uuid');
      const demoPassword = process.env.DEMO_PASSWORD || crypto.randomBytes(18).toString('base64url');
      const password = bcrypt.hashSync(demoPassword, 10);
      
      // Demo admin
      const adminId = uuidv4();
      db.prepare(`
        INSERT INTO users (id, email, password, company_name, sector, role, plan)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(adminId, 'admin@nummy.com', password, 'NUMMY', 'Technology', 'admin', 'enterprise');
      
      // Demo client
      const clientId = uuidv4();
      db.prepare(`
        INSERT INTO users (id, email, password, company_name, sector, role, plan)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(clientId, 'demo@azienda.it', password, 'Demo SRL', 'Servizi', 'client', 'pro');
      
      // Demo agent
      const agentId = uuidv4();
      db.prepare(`
        INSERT INTO agents (id, user_id, name, tone, welcome_message, qualification_questions, transfer_conditions)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        agentId, 
        clientId, 
        'Agente NUMMY',
        'professionale', 
        'Ciao! Sono l\'assistente virtuale di Demo SRL. Come posso aiutarti oggi?',
        JSON.stringify([
          { question: 'Quale servizio ti interessa?', field: 'service', required: true },
          { question: 'Quanto è urgente?', field: 'urgency', required: false }
        ]),
        JSON.stringify({ min_score: 7, has_email: true, has_phone: true })
      );
      
      // Demo leads
      const lead1Id = uuidv4();
      const lead2Id = uuidv4();
      db.prepare(`
        INSERT INTO leads (id, user_id, name, email, phone, source, status, score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(lead1Id, clientId, 'Cliente Demo A', 'lead-a@example.invalid', '+39 000 0000001', 'whatsapp', 'qualified', 8);
      
      db.prepare(`
        INSERT INTO leads (id, user_id, name, email, phone, source, status, score)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(lead2Id, clientId, 'Cliente Demo B', 'lead-b@example.invalid', '+39 000 0000002', 'website', 'new', 3);
      
      // Demo conversations
      db.prepare(`
        INSERT INTO conversations (id, user_id, lead_id, agent_id, channel, messages, status)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        uuidv4(), clientId, lead1Id, agentId, 'whatsapp',
        JSON.stringify([
          { role: 'lead', content: 'Buongiorno, vorrei informazioni sui vostri servizi', timestamp: new Date().toISOString() },
          { role: 'agent', content: 'Buongiorno! Certamente, quale servizio ti interessa?', timestamp: new Date().toISOString() }
        ]),
        'active'
      );
      
      // Demo automations
      const autoFeatures = [
        { name: 'Risposta automatica ai lead', trigger: 'new_lead', actions: ['send_welcome'] },
        { name: 'Qualificazione cliente', trigger: 'first_message', actions: ['ask_questions', 'score_lead'] },
        { name: 'Follow-up 1 giorno', trigger: 'no_response_24h', actions: ['send_followup'] },
        { name: 'Notifica commerciale', trigger: 'lead_qualified', actions: ['notify_sales_team'] }
      ];
      
      for (const auto of autoFeatures) {
        db.prepare(`
          INSERT INTO automations (id, user_id, name, trigger_event, actions, is_active)
          VALUES (?, ?, ?, ?, ?, 1)
        `).run(uuidv4(), clientId, auto.name, auto.trigger, JSON.stringify(auto.actions));
      }
      
      // Demo appointment
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(10, 0, 0, 0);
      const endTime = new Date(tomorrow);
      endTime.setHours(11, 0, 0, 0);
      
      db.prepare(`
        INSERT INTO appointments (id, user_id, lead_id, title, description, start_time, end_time, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), clientId, lead1Id, 'Demo servizi', 'Presentazione servizi al cliente demo',
        tomorrow.toISOString(), endTime.toISOString(), 'scheduled');
      
      // Demo usage stats
      const today = new Date().toISOString().split('T')[0];
      db.prepare(`
        INSERT INTO usage_stats (id, user_id, date, conversations_count, leads_count, messages_count, follow_ups_sent, appointments_scheduled)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(uuidv4(), clientId, today, 15, 8, 47, 3, 2);
      
      console.log('✅ Dati demo inseriti con successo!');
      console.log('   Admin: admin@nummy.com');
      console.log('   Demo:  demo@azienda.it');
      console.log(`   Password demo: ${demoPassword}${process.env.DEMO_PASSWORD ? ' (da DEMO_PASSWORD)' : ' (generata per questa inizializzazione)'}`);
    } else {
      console.log('✅ Database già popolato. Saltato inserimento dati demo.');
    }
    
    console.log('✅ Database inizializzato con successo!');
  } catch (error) {
    console.error('❌ Errore durante l\'inizializzazione del database:', error);
    process.exit(1);
  }
}
