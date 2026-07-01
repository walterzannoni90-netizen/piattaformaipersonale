/**
 * WhatsApp Business API Service
 */
const axios = require('axios');
const { getDatabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class WhatsAppService {
  async sendMessage(userId, to, message) {
    const db = getDatabase();
    const config = db.prepare('SELECT * FROM api_keys WHERE user_id = ? AND service = "whatsapp" AND is_active = 1').get(userId);
    
    if (!config) {
      throw new Error('WhatsApp non configurato');
    }
    
    const apiKey = config.key_value;
    const phoneId = db.prepare('SELECT key_value FROM api_keys WHERE user_id = ? AND service = "whatsapp_phone_id"').get(userId)?.key_value;
    
    // In production, this would call the WhatsApp Business API
    // For now, we log the message
    console.log(`[WhatsApp] To: ${to} - Message: ${message}`);
    
    // Log in database
    const conversation = db.prepare(`
      SELECT * FROM conversations 
      WHERE user_id = ? AND status = 'active' 
      ORDER BY updated_at DESC LIMIT 1
    `).get(userId);
    
    if (conversation) {
      const messages = JSON.parse(conversation.messages || '[]');
      messages.push({
        role: 'agent',
        content: message,
        channel: 'whatsapp',
        timestamp: new Date().toISOString()
      });
      db.prepare('UPDATE conversations SET messages = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(JSON.stringify(messages), conversation.id);
    }
    
    return { success: true, messageId: uuidv4() };
  }

  async handleIncoming(userId, from, message) {
    const db = getDatabase();
    
    // Find or create lead
    let lead = db.prepare('SELECT * FROM leads WHERE phone = ? AND user_id = ?').get(from, userId);
    if (!lead) {
      const leadId = uuidv4();
      db.prepare(`
        INSERT INTO leads (id, user_id, name, phone, source, status)
        VALUES (?, ?, ?, ?, 'whatsapp', 'new')
      `).run(leadId, userId, from, from);
      lead = { id: leadId };
    }
    
    // Find or create conversation
    let conversation = db.prepare(`
      SELECT * FROM conversations WHERE lead_id = ? AND status = 'active'
    `).get(lead.id);
    
    if (!conversation) {
      const agent = db.prepare('SELECT * FROM agents WHERE user_id = ? AND is_active = 1').get(userId);
      const convId = uuidv4();
      db.prepare(`
        INSERT INTO conversations (id, user_id, lead_id, agent_id, channel, messages)
        VALUES (?, ?, ?, ?, 'whatsapp', ?)
      `).run(convId, userId, lead.id, agent?.id, JSON.stringify([]));
      conversation = { id: convId, messages: '[]' };
    }
    
    // Add message to conversation
    const messages = JSON.parse(conversation.messages || '[]');
    messages.push({
      role: 'lead',
      content: message,
      channel: 'whatsapp',
      timestamp: new Date().toISOString()
    });
    db.prepare('UPDATE conversations SET messages = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
      .run(JSON.stringify(messages), conversation.id);
    
    // Update lead info
    db.prepare('UPDATE leads SET last_contact = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(lead.id);
    
    return { lead, conversation };
  }
}

module.exports = new WhatsAppService();
