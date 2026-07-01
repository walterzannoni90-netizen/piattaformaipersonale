/**
 * Stripe Payment Service
 */
const { getDatabase } = require('../config/database');
const { v4: uuidv4 } = require('uuid');

class StripeService {
  constructor() {
    this.stripe = null;
  }

  init() {
    if (process.env.STRIPE_SECRET_KEY && !this.stripe) {
      try {
        this.stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
      } catch (e) {
        console.warn('Stripe not available, using simulated payments');
      }
    }
  }

  async createCheckoutSession(userId, plan, successUrl, cancelUrl) {
    const db = getDatabase();
    const user = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
    if (!user) throw new Error('Utente non trovato');
    
    const app = require('../config/app');
    const planConfig = app.plans[plan];
    if (!planConfig) throw new Error('Piano non valido');
    
    if (!this.stripe) {
      // Simulated checkout
      const sessionId = uuidv4();
      const subscriptionId = uuidv4();
      
      // Create subscription directly
      db.prepare(`
        INSERT OR REPLACE INTO subscriptions (id, user_id, plan, status, current_period_start, current_period_end)
        VALUES (?, ?, ?, 'active', datetime('now'), datetime('now', '+1 month'))
      `).run(subscriptionId, userId, plan);
      
      db.prepare('UPDATE users SET plan = ? WHERE id = ?').run(plan, userId);
      
      return { 
        success: true, 
        sessionId, 
        subscriptionId,
        url: '/dashboard?payment=success',
        simulated: true 
      };
    }
    
    // Real Stripe implementation
    const session = await this.stripe.checkout.sessions.create({
      payment_method_types: ['card'],
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: `WES AI Automation - ${planConfig.name}`,
              description: planConfig.features.join(', '),
            },
            unit_amount: planConfig.price * 100, // cents
            recurring: { interval: 'month' },
          },
          quantity: 1,
        },
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: 'Setup Iniziale',
              description: 'Configurazione e onboarding',
            },
            unit_amount: planConfig.setupFee * 100,
          },
          quantity: 1,
        }
      ],
      mode: 'subscription',
      success_url: successUrl || `${process.env.APP_URL}/dashboard?payment=success`,
      cancel_url: cancelUrl || `${process.env.APP_URL}/prezzi?payment=cancel`,
      metadata: { userId, plan }
    });
    
    return { success: true, sessionId: session.id, url: session.url };
  }

  async handleWebhook(event) {
    const db = getDatabase();
    
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        const { userId, plan } = session.metadata;
        
        const subscriptionId = uuidv4();
        db.prepare(`
          INSERT OR REPLACE INTO subscriptions (id, user_id, plan, status, current_period_start, current_period_end, stripe_subscription_id)
          VALUES (?, ?, ?, 'active', datetime('now'), datetime('now', '+1 month'), ?)
        `).run(subscriptionId, userId, plan, session.subscription);
        
        db.prepare('UPDATE users SET plan = ?, setup_fee_paid = 1 WHERE id = ?').run(plan, userId);
        
        db.prepare(`
          INSERT INTO logs (id, user_id, level, action, details)
          VALUES (?, ?, 'info', 'payment_completed', ?)
        `).run(uuidv4(), userId, JSON.stringify({ plan, amount: session.amount_total }));
        break;
      }
      
      case 'invoice.paid': {
        const invoice = event.data.object;
        db.prepare(`
          INSERT INTO logs (id, user_id, level, action, details)
          VALUES (?, ?, 'info', 'invoice_paid', ?)
        `).run(uuidv4(), invoice.metadata?.userId, JSON.stringify({ invoiceId: invoice.id }));
        break;
      }
      
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const existing = db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id = ?').get(subscription.id);
        if (existing) {
          db.prepare('UPDATE subscriptions SET status = "cancelled", cancelled_at = CURRENT_TIMESTAMP WHERE id = ?').run(existing.id);
          db.prepare('UPDATE users SET plan = "starter" WHERE id = ?').run(existing.user_id);
        }
        break;
      }
    }
    
    return { received: true };
  }
}

module.exports = new StripeService();
