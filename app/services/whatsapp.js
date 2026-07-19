/**
 * WhatsApp Business API Service
 */
const axios = require('axios');
const { getDatabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');
const secretVault = require('./secretVault');
const { normalizePhone, validPhone } = require('../utils/contact');

function recordMessageUsage(db, userId, { newLead = false, newConversation = false } = {}) {
  const today = new Date().toISOString().slice(0, 10);
  db.prepare('INSERT OR IGNORE INTO usage_stats (id, user_id, date) VALUES (?, ?, ?)').run(uuidv4(), userId, today);
  db.prepare(`UPDATE usage_stats SET messages_count = messages_count + 1,
    leads_count = leads_count + ?, conversations_count = conversations_count + ? WHERE user_id = ? AND date = ?`)
    .run(newLead ? 1 : 0, newConversation ? 1 : 0, userId, today);
}

class WhatsAppService {
  graphVersion() {
    return process.env.META_GRAPH_VERSION || 'v22.0';
  }

  getConfig(userId) {
    const personalToken = secretVault.getSecret(userId, 'whatsapp');
    const personalPhoneId = secretVault.getSecret(userId, 'whatsapp_phone_id');
    const canUsePlatformConfig = process.env.WHATSAPP_OWNER_USER_ID === userId;
    const token = personalToken || (canUsePlatformConfig ? process.env.WHATSAPP_API_KEY : null);
    const phoneId = personalPhoneId || (canUsePlatformConfig ? process.env.WHATSAPP_PHONE_ID : null);
    if (!token || !phoneId) throw new Error('WhatsApp non configurato completamente');
    return { token, phoneId };
  }

  async sendMessage(userId, to, message) {
    const db = getDatabase();
    const { token, phoneId } = this.getConfig(userId);
    const recipient = normalizePhone(to);
    const content = String(message || '').trim();
    if (!/^\d{7,20}$/.test(recipient) || !content) throw new Error('Destinatario e messaggio sono obbligatori');
    if (content.length > 4096) throw new Error('Il messaggio WhatsApp supera 4096 caratteri');

    const response = await axios.post(
      `https://graph.facebook.com/${this.graphVersion()}/${encodeURIComponent(phoneId)}/messages`,
      { messaging_product: 'whatsapp', recipient_type: 'individual', to: recipient, type: 'text', text: { preview_url: false, body: content } },
      { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, timeout: 15000 }
    );
    const messageId = response.data?.messages?.[0]?.id;
    if (!messageId) throw new Error('WhatsApp non ha restituito un ID messaggio');
    
    // Log in database
    const conversation = db.prepare(`
      SELECT conversations.* FROM conversations
      JOIN leads l ON l.id = conversations.lead_id
      WHERE conversations.user_id = ? AND l.phone_normalized = ? AND conversations.status = 'active'
      ORDER BY conversations.updated_at DESC LIMIT 1
    `).get(userId, recipient);
    
    if (conversation) {
      let messages;
      try { messages = JSON.parse(conversation.messages || '[]'); } catch { messages = []; }
      messages.push({
        role: 'agent',
        content,
        channel: 'whatsapp',
        timestamp: new Date().toISOString()
      });
      db.prepare('UPDATE conversations SET messages = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
        .run(JSON.stringify(messages.slice(-500)), conversation.id, userId);
    }
    
    recordMessageUsage(db, userId);
    return { success: true, messageId };
  }

  findUserByPhoneId(phoneId) {
    const candidates = getDatabase().prepare("SELECT user_id, key_value FROM api_keys WHERE service = 'whatsapp_phone_id' AND is_active = 1").all();
    const owner = candidates.find((candidate) => {
      try { return secretVault.open(candidate.key_value) === phoneId; } catch { return false; }
    })?.user_id;
    if (owner) return owner;
    if (process.env.WHATSAPP_OWNER_USER_ID && process.env.WHATSAPP_PHONE_ID === phoneId) return process.env.WHATSAPP_OWNER_USER_ID;
    return null;
  }

  async verifyConfig(token, phoneId) {
    const response = await axios.get(`https://graph.facebook.com/${this.graphVersion()}/${encodeURIComponent(phoneId)}`, {
      params: { fields: 'display_phone_number,verified_name' },
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15_000,
      maxContentLength: 200_000
    });
    return { displayPhoneNumber: response.data?.display_phone_number, verifiedName: response.data?.verified_name };
  }

  async handleWebhook(body) {
    const changes = body?.entry?.flatMap((entry) => entry.changes || []) || [];
    const results = [];
    const db = getDatabase();
    for (const change of changes) {
      const value = change.value || {};
      const userId = this.findUserByPhoneId(value.metadata?.phone_number_id);
      if (!userId) continue;
      for (const incoming of value.messages || []) {
        const eventId = String(incoming.id || '').slice(0, 240);
        const text = String(incoming.text?.body || '').trim().slice(0, 4096);
        if (!eventId || incoming.type !== 'text' || !text) continue;
        if (db.prepare("SELECT event_id FROM processed_webhook_events WHERE provider = 'whatsapp' AND event_id = ?").get(eventId)) continue;
        const result = await this.handleIncoming(userId, incoming.from, text);
        db.prepare(`INSERT OR IGNORE INTO processed_webhook_events (provider, event_id, event_type, user_id)
          VALUES ('whatsapp', ?, 'message', ?)`).run(eventId, userId);
        result.userId = userId;
        result.eventId = eventId;
        results.push(result);
      }
    }
    return results;
  }

  async handleIncoming(userId, from, message) {
    const db = getDatabase();
    const normalizedPhone = normalizePhone(from);
    const content = String(message || '').trim().slice(0, 4096);
    if (!validPhone(normalizedPhone) || !content) throw new Error('Messaggio WhatsApp in ingresso non valido');
    
    // Find or create lead
    let lead = db.prepare('SELECT * FROM leads WHERE phone_normalized = ? AND user_id = ?').get(normalizedPhone, userId);
    let newLead = false;
    if (!lead) {
      const leadId = uuidv4();
      db.prepare(`
        INSERT INTO leads (id, user_id, name, phone, phone_normalized, source, status)
        VALUES (?, ?, ?, ?, ?, 'whatsapp', 'new')
      `).run(leadId, userId, normalizedPhone, normalizedPhone, normalizedPhone);
      lead = db.prepare('SELECT * FROM leads WHERE id = ? AND user_id = ?').get(leadId, userId);
      newLead = true;
    }
    
    // Find or create conversation
    let conversation = db.prepare(`SELECT * FROM conversations WHERE lead_id = ? AND user_id = ? AND status = 'active' ORDER BY updated_at DESC LIMIT 1`).get(lead.id, userId);
    
    const isFirstMessage = !conversation;
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
    let messages;
    try { messages = JSON.parse(conversation.messages || '[]'); } catch { messages = []; }
    messages.push({
      role: 'lead',
      content,
      channel: 'whatsapp',
      timestamp: new Date().toISOString()
    });
    const retainedMessages = messages.slice(-500);
    db.prepare('UPDATE conversations SET messages = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?')
      .run(JSON.stringify(retainedMessages), conversation.id, userId);
    conversation.messages = JSON.stringify(retainedMessages);
    
    // Update lead info
    db.prepare('UPDATE leads SET last_contact = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').run(lead.id, userId);
    recordMessageUsage(db, userId, { newLead, newConversation: isFirstMessage });
    
    return { lead, conversation, isFirstMessage };
  }
}

module.exports = new WhatsAppService();
