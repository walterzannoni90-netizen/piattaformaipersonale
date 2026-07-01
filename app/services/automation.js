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
    
    try {
      // Find all active automations for this event
      const automations = db.prepare(`
        SELECT * FROM automations 
        WHERE trigger_event = ? AND is_active = 1
      `).all(event);
      
      for (const auto of automations) {
        await this.executeAutomation(auto, data);
      }
      
      // Log the trigger
      db.prepare(`
        INSERT INTO logs (id, user_id, level, action, details)
        VALUES (?, ?, 'info', 'automation_triggered', ?)
      `).run(uuidv4(), data.user_id, JSON.stringify({ event, data: JSON.stringify(data) }));
      
    } catch (error) {
      console.error('Automation error:', error);
    }
  }

  async executeAutomation(auto, data) {
    const actions = JSON.parse(auto.actions);
    const db = getDatabase();
    
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
        case 'notify_sales_team':
          await this.notifySalesTeam(auto.user_id, data.lead);
          break;
        case 'generate_report':
          await this.generateReport(auto.user_id);
          break;
      }
    }
    
    // Update last run
    db.prepare('UPDATE automations SET last_run = CURRENT_TIMESTAMP WHERE id = ?').run(auto.id);
  }

  async sendWelcome(userId, lead) {
    // Implementation: send welcome message via WhatsApp/email
    const db = getDatabase();
    const agent = db.prepare('SELECT * FROM agents WHERE user_id = ? AND is_active = 1').get(userId);
    if (!agent) return;
    
    const message = agent.welcome_message?.replace('[azienda]', 
      db.prepare('SELECT company_name FROM users WHERE id = ?').get(userId)?.company_name || '') 
      || 'Ciao! Come posso aiutarti?';
    
    // Save message to conversation
    const conversation = db.prepare('SELECT * FROM conversations WHERE lead_id = ? AND status = "active"').get(lead?.id);
    if (conversation) {
      const messages = JSON.parse(conversation.messages || '[]');
      messages.push({ role: 'agent', content: message, timestamp: new Date().toISOString() });
      db.prepare('UPDATE conversations SET messages = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(JSON.stringify(messages), conversation.id);
    }
    
    this.logAction(userId, 'welcome_sent', { lead_id: lead?.id });
  }

  async askQualificationQuestions(userId, lead) {
    const db = getDatabase();
    const agent = db.prepare('SELECT * FROM agents WHERE user_id = ? AND is_active = 1').get(userId);
    if (!agent) return;
    
    const questions = JSON.parse(agent.qualification_questions || '[]');
    if (questions.length === 0) return;
    
    // Find or create conversation
    let conversation = db.prepare('SELECT * FROM conversations WHERE lead_id = ? AND status = "active"').get(lead?.id);
    if (!conversation) {
      const convId = uuidv4();
      db.prepare(`
        INSERT INTO conversations (id, user_id, lead_id, agent_id, channel, messages)
        VALUES (?, ?, ?, ?, 'whatsapp', ?)
      `).run(convId, userId, lead?.id, agent.id, JSON.stringify([]));
      conversation = { id: convId, messages: '[]' };
    }
    
    const messages = JSON.parse(conversation.messages || '[]');
    const firstQuestion = questions[0];
    messages.push({ 
      role: 'agent', 
      content: firstQuestion.question,
      metadata: { field: firstQuestion.field, required: firstQuestion.required },
      timestamp: new Date().toISOString()
    });
    
    db.prepare('UPDATE conversations SET messages = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(messages), conversation.id);
    
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
      db.prepare('UPDATE leads SET score = ?, status = CASE WHEN ? >= 7 THEN "qualified" ELSE status END, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(Math.min(score, 10), score, lead.id);
      
      // If qualified, trigger lead_qualified event
      if (score >= 7) {
        this.trigger('lead_qualified', { ...lead, score, user_id: userId });
      }
    }
    
    this.logAction(userId, 'lead_scored', { lead_id: lead?.id, score });
  }

  async saveToCRM(userId, lead) {
    // This would integrate with external CRM systems
    this.logAction(userId, 'crm_saved', { lead_id: lead?.id });
  }

  async scheduleAppointment(userId, lead) {
    // Auto-scheduling logic
    this.logAction(userId, 'appointment_auto_scheduled', { lead_id: lead?.id });
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
    // Send notification to sales team (email, Slack, etc.)
    this.logAction(userId, 'sales_notified', { lead_id: lead?.id });
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
    
    // In real implementation, this would send an email with the report
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

// Check and execute pending follow-ups
async function processPendingFollowUps() {
  const db = getDatabase();
  const pending = db.prepare(`
    SELECT f.*, l.user_id 
    FROM follow_ups f
    JOIN leads l ON l.id = f.lead_id
    WHERE f.status = 'pending' AND f.scheduled_at <= datetime('now')
  `).all();
  
  for (const followUp of pending) {
    try {
      // In real implementation: send the message via WhatsApp/email
      db.prepare('UPDATE follow_ups SET status = "sent", executed_at = CURRENT_TIMESTAMP WHERE id = ?').run(followUp.id);
    } catch (error) {
      db.prepare('UPDATE follow_ups SET status = "failed" WHERE id = ?').run(followUp.id);
    }
  }
}

module.exports = {
  AutomationEngine: new AutomationEngine(),
  processPendingFollowUps
};
