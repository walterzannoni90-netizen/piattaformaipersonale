/**
 * WhatsApp Business API Service
 */
const axios = require('axios');
const { getDatabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class WhatsAppService {
  getConfig(userId) {
    const db = getDatabase();
    const token = db.prepare('SELECT key_value FROM api_keys WHERE user_id = ? AND service = "whatsapp" AND is_active = 1').get(userId)?.key_value;
    const phoneId = db.prepare('SELECT key_value FROM api_keys WHERE user_id = ? AND service = "whatsapp_phone_id" AND is_active = 1').get(userId)?.key_value;
    if (!token || !phoneId) throw new Error('WhatsApp non configurato completamente');
    return { token, phoneId };
  }

  async sendMessage(userId, to, message) {
    const db = getDatabase();
    const { token, phoneId } = this.getConfig(userId);
    if (!to || !message) throw new Error('Destinatario e messaggio sono obbligatori');

    const response = await axios.post(
      `https://graph.facebook.com/v22.0/${encodeURIComponent(phoneId)}/messages`,
      { messaging_product: 'whatsapp', recipient_type: 'individual', to, type: 'text', text: { preview_url: false, body: message } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    
    // Log in database
    const conversation = db.prepare(`
      SELECT conversations.* FROM conversations
      JOIN leads l ON l.id = conversations.lead_id
      WHERE conversations.user_id = ? AND l.phone = ? AND conversations.status = 'active'
      ORDER BY conversations.updated_at DESC LIMIT 1
    `).get(userId, to);
    
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
    
    const messageId = response.data?.messages?.[0]?.id;
    if (!messageId) throw new Error('WhatsApp non ha restituito un ID messaggio');
    return { success: true, messageId };
  }

  findUserByPhoneId(phoneId) {
    return getDatabase().prepare(`
      SELECT user_id FROM api_keys
      WHERE service = 'whatsapp_phone_id' AND key_value = ? AND is_active = 1
    `).get(phoneId)?.user_id;
  }

  async handleWebhook(body) {
    const changes = body?.entry?.flatMap((entry) => entry.changes || []) || [];
    for (const change of changes) {
      const value = change.value || {};
      const userId = this.findUserByPhoneId(value.metadata?.phone_number_id);
      if (!userId) continue;
      for (const incoming of value.messages || []) {
        const text = incoming.text?.body;
        if (incoming.type !== 'text' || !text) continue;
        const result = await this.handleIncoming(userId, incoming.from, text);
        result.userId = userId;
        return result;
      }
    }
    return null;
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
    let conversation = db.prepare(`SELECT * FROM conversations WHERE lead_id = ? AND user_id = ? AND status = 'active'`).get(lead.id, userId);
    
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
    conversation.messages = JSON.stringify(messages);
    
    // Update lead info
    db.prepare('UPDATE leads SET last_contact = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(lead.id);
    
    return { lead, conversation };
  }
}

module.exports = new WhatsAppService();
