/**
 * Automation Engine
 * Core service that handles all automations
 */
const { getDatabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class AutomationEngine {
  constructor() {
    // Triggers are handled by the trigger() method directly
  }

  async trigger(event, data = {}) {
    const db = getDatabase();
    if (!data.user_id) throw new Error('Automazione senza proprietario');

    const automations = db.prepare(`
      SELECT * FROM automations
      WHERE trigger_event = ? AND user_id = ? AND is_active = 1
    `).all(event, data.user_id);
    const executedActions = [];
    const errors = [];
    for (const auto of automations) {
      try {
        executedActions.push(...await this.executeAutomation(auto, data));
      } catch (error) {
        errors.push({ automationId: auto.id, error: String(error.message || error).slice(0, 500) });
        db.prepare(`INSERT INTO logs (id, user_id, level, action, details)
          VALUES (?, ?, 'error', 'automation_failed', ?)`)
          .run(uuidv4(), data.user_id, JSON.stringify({ event, automation_id: auto.id, error: String(error.message || error).slice(0, 500) }));
      }
    }

    db.prepare(`INSERT INTO logs (id, user_id, level, action, details)
      VALUES (?, ?, 'info', 'automation_triggered', ?)`)
      .run(uuidv4(), data.user_id, JSON.stringify({ event, automations: automations.map((automation) => automation.id), errors: errors.length }));
    return { executedActions, errors };
  }

  async executeAutomation(auto, data) {
    const actions = JSON.parse(auto.actions);
    const db = getDatabase();
    const executed = [];
    
    for (const action of actions) {
      switch (action) {
        case 'send_welcome':
          await this.sendWelcome(auto.user_id, data.lead);
          break;
        case 'ask_questions':
          await this.askQualificationQuestions(auto.user_id, data.lead);
          break;
        case 'score_lead':
          await this.scoreLead(auto.user_id, data.lead, data.messages);
          break;
        case 'save_crm':
          await this.saveToCRM(auto.user_id, data.lead);
          break;
        case 'schedule_appointment':
          await this.scheduleAppointment(auto.user_id, data.lead);
          break;
        case 'send_followup':
          await this.sendFollowUp(auto.user_id, data.lead, data.type || '1day');
          break;
        case 'send_followup_3days':
          await this.sendFollowUp(auto.user_id, data.lead, '3days');
          break;
        case 'notify_sales_team':
          await this.notifySalesTeam(auto.user_id, data.lead);
          break;
        case 'generate_report':
          await this.generateReport(auto.user_id);
          break;
        default:
          throw new Error(`Azione automazione non consentita: ${String(action).slice(0, 80)}`);
      }
      executed.push(action);
    }
    
    // Update last run
    db.prepare('UPDATE automations SET last_run = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(auto.id, auto.user_id);
    return executed;
  }

  async sendWelcome(userId, lead) {
    const db = getDatabase();
    const agent = db.prepare('SELECT * FROM agents WHERE user_id = ? AND is_active = 1').get(userId);
    if (!agent) return;
    
    const message = agent.welcome_message?.replace('[azienda]', 
      db.prepare('SELECT company_name FROM users WHERE id = ?').get(userId)?.company_name || '') 
      || 'Ciao! Come posso aiutarti?';
    
    if (!lead?.phone) throw new Error('Lead senza numero WhatsApp');
    await require('./whatsapp').sendMessage(userId, lead.phone, message);
    
    this.logAction(userId, 'welcome_sent', { lead_id: lead?.id });
  }

  async askQualificationQuestions(userId, lead) {
    const db = getDatabase();
    const agent = db.prepare('SELECT * FROM agents WHERE user_id = ? AND is_active = 1').get(userId);
    if (!agent) return;
    
    const questions = JSON.parse(agent.qualification_questions || '[]');
    if (questions.length === 0) return;
    
    const firstQuestion = questions[0];
    if (!lead?.phone) throw new Error('Lead senza numero WhatsApp');
    await require('./whatsapp').sendMessage(userId, lead.phone, firstQuestion.question);
    
    this.logAction(userId, 'qualification_asked', { lead_id: lead?.id, question: firstQuestion.question });
  }

  async scoreLead(userId, lead, messages) {
    const db = getDatabase();
    
    // Simple scoring based on engagement
    let score = 0;
    if (messages && Array.isArray(messages)) {
      const leadMessages = messages.filter(m => m.role === 'lead');
      score += Math.min(leadMessages.length * 2, 5); // Up to 5 points for engagement
      
      // Check for contact info
      const allText = leadMessages.map(m => m.content).join(' ');
      if (allText.includes('@')) score += 2; // Has email
      if (allText.match(/\+?\d{7,}/)) score += 2; // Has phone
      if (allText.toLowerCase().includes('prezzo') || allText.toLowerCase().includes('costo')) score += 1;
      if (allText.toLowerCase().includes('quanto') || allText.toLowerCase().includes('vorrei')) score += 1;
    }
    
    // Update lead score
    if (lead?.id) {
      db.prepare('UPDATE leads SET score = ?, status = CASE WHEN ? >= 7 THEN "qualified" ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
        .run(Math.min(score, 10), score, lead.id, userId);
      
      // If qualified, trigger lead_qualified event
      if (score >= 7) {
        await this.trigger('lead_qualified', { lead: { ...lead, score }, user_id: userId });
      }
    }
    
    this.logAction(userId, 'lead_scored', { lead_id: lead?.id, score });
  }

  async saveToCRM(userId, lead) {
    const record = lead?.id && getDatabase().prepare('SELECT id FROM leads WHERE id = ? AND user_id = ?').get(lead.id, userId);
    if (!record) throw new Error('Lead CRM non trovato');
    this.logAction(userId, 'crm_record_confirmed', { lead_id: lead.id });
  }

  async scheduleAppointment(userId, lead) {
    this.logAction(userId, 'appointment_requested', { lead_id: lead?.id, note: 'Serve una disponibilità esplicita prima della creazione.' });
  }

  async sendFollowUp(userId, lead, type = '1day') {
    const db = getDatabase();
    const messages = {
      '1day': 'Ciao! Ti scrivo per vedere se hai avuto modo di valutare la nostra proposta. Hai domande?',
      '3days': 'Buongiorno! Non vorrei disturbare, ma volevo ricordarti che siamo qui per aiutarti. Se hai bisogno di informazioni o vuoi fissare una chiamata, fammi sapere!'
    };
    
    const content = messages[type] || messages['1day'];
    
    // Schedule the follow-up
    const followUpId = uuidv4();
    const scheduledAt = new Date();
    scheduledAt.setHours(scheduledAt.getHours() + (type === '3days' ? 72 : 24));
    
    db.prepare(`
      INSERT INTO follow_ups (id, user_id, lead_id, type, delay_hours, message_template, scheduled_at, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    `).run(followUpId, userId, lead?.id, type, type === '3days' ? 72 : 24, content, scheduledAt.toISOString());
    
    this.logAction(userId, 'followup_scheduled', { lead_id: lead?.id, type, scheduled_at: scheduledAt.toISOString() });
  }

  async notifySalesTeam(userId, lead) {
    const db = getDatabase();
    const user = db.prepare('SELECT email, company_name FROM users WHERE id = ?').get(userId);
    if (!user?.email) throw new Error('Email commerciale non disponibile');
    const safeName = String(lead?.name || 'Nuovo lead').replace(/[<>&"']/g, '');
    const result = await require('./email').sendEmail(
      userId,
      user.email,
      'Nuovo lead qualificato',
      `<p>WES ha qualificato <strong>${safeName}</strong>. Apri il CRM interno per verificare i dettagli prima di contattarlo.</p>`
    );
    if (!result.success) throw new Error(result.error);
    this.logAction(userId, 'sales_notified', { lead_id: lead?.id, channel: 'email' });
  }

  async generateReport(userId) {
    const db = getDatabase();
    
    const stats = db.prepare(`
      SELECT 
        COUNT(DISTINCT l.id) as total_leads,
        COUNT(DISTINCT c.id) as total_conversations,
        COUNT(DISTINCT a.id) as total_appointments,
        COUNT(DISTINCT f.id) as total_followups
      FROM users u
      LEFT JOIN leads l ON l.user_id = u.id AND l.created_at >= datetime('now', '-7 days')
      LEFT JOIN conversations c ON c.user_id = u.id AND c.created_at >= datetime('now', '-7 days')
      LEFT JOIN appointments a ON a.user_id = u.id AND a.created_at >= datetime('now', '-7 days')
      LEFT JOIN follow_ups f ON f.user_id = u.id AND f.executed_at >= datetime('now', '-7 days')
      WHERE u.id = ?
    `).get(userId);
    
    const user = db.prepare('SELECT email FROM users WHERE id = ?').get(userId);
    if (!user?.email) throw new Error('Email utente non disponibile');
    const result = await require('./email').sendWeeklyReport(userId, user.email, {
      leads: stats.total_leads,
      conversations: stats.total_conversations,
      appointments: stats.total_appointments,
      followups: stats.total_followups
    });
    if (!result.success) throw new Error(result.error);
    this.logAction(userId, 'weekly_report_generated', { stats });
  }

  logAction(userId, action, details) {
    const db = getDatabase();
    db.prepare(`
      INSERT INTO logs (id, user_id, level, action, details)
      VALUES (?, ?, 'info', ?, ?)
    `).run(uuidv4(), userId, action, JSON.stringify(details));
  }
}

let followUpsProcessing = false;
let scheduledAutomationsProcessing = false;

function recoverInterruptedFollowUps() {
  const db = getDatabase();
  const interrupted = db.prepare("UPDATE follow_ups SET status = 'uncertain' WHERE status = 'sending'").run().changes;
  if (interrupted) {
    db.prepare(`INSERT INTO logs (id, level, action, details) VALUES (?, 'warning', 'followups_marked_uncertain', ?)`)
      .run(uuidv4(), JSON.stringify({ count: interrupted, reason: 'process_restart' }));
  }
  return interrupted;
}

// Check and execute pending follow-ups
async function processPendingFollowUps() {
  if (followUpsProcessing) return;
  followUpsProcessing = true;
  try {
  const db = getDatabase();
  const pending = db.prepare(`
    SELECT f.*
    FROM follow_ups f
    JOIN leads l ON l.id = f.lead_id AND l.user_id = f.user_id
    WHERE f.status = 'pending' AND f.scheduled_at <= datetime('now')
  `).all();
  
  for (const followUp of pending) {
    const locked = db.prepare("UPDATE follow_ups SET status = 'sending' WHERE id = ? AND user_id = ? AND status = 'pending'")
      .run(followUp.id, followUp.user_id);
    if (!locked.changes) continue;
    try {
      const lead = db.prepare('SELECT phone, email FROM leads WHERE id = ? AND user_id = ?').get(followUp.lead_id, followUp.user_id);
      if (followUp.channel === 'email') {
        if (!lead?.email) throw new Error('Lead senza email');
        const result = await require('./email').sendEmail(followUp.user_id, lead.email, 'Un messaggio per te', followUp.message_template);
        if (!result.success) throw new Error(result.error);
      } else {
        if (!lead?.phone) throw new Error('Lead senza telefono');
        await require('./whatsapp').sendMessage(followUp.user_id, lead.phone, followUp.message_template);
      }
      db.prepare('UPDATE follow_ups SET status = "sent", executed_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(followUp.id, followUp.user_id);
    } catch (error) {
      db.prepare('UPDATE follow_ups SET status = "uncertain" WHERE id = ? AND user_id = ?').run(followUp.id, followUp.user_id);
      db.prepare(`INSERT INTO logs (id, user_id, level, action, details) VALUES (?, ?, 'error', 'followup_uncertain', ?)`)
        .run(uuidv4(), followUp.user_id, JSON.stringify({ follow_up_id: followUp.id, error: error.message }));
    }
  }
  } finally {
    followUpsProcessing = false;
  }
}

async function processScheduledAutomations() {
  if (scheduledAutomationsProcessing) return;
  scheduledAutomationsProcessing = true;
  try {
  const db = getDatabase();
  const due = db.prepare(`
    SELECT * FROM automations
    WHERE trigger_event = 'weekly_schedule' AND is_active = 1
      AND (last_run IS NULL OR last_run <= datetime('now', '-7 days'))
    ORDER BY created_at ASC LIMIT 20
  `).all();
  for (const automation of due) {
    try {
      await module.exports.AutomationEngine.executeAutomation(automation, { user_id: automation.user_id });
    } catch (error) {
      db.prepare('UPDATE automations SET last_run = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(automation.id, automation.user_id);
      db.prepare(`INSERT INTO logs (id, user_id, level, action, details) VALUES (?, ?, 'error', 'scheduled_automation_failed', ?)`)
        .run(uuidv4(), automation.user_id, JSON.stringify({ automation_id: automation.id, error: error.message }));
    }
  }
  } finally {
    scheduledAutomationsProcessing = false;
  }
}

module.exports = {
  AutomationEngine: new AutomationEngine(),
  processPendingFollowUps,
  processScheduledAutomations,
  recoverInterruptedFollowUps
};
