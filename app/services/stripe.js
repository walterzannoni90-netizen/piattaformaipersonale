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
        console.warn('Stripe non disponibile');
      }
    }
  }

  async createCheckoutSession(userId, plan, successUrl, cancelUrl) {
    const db = getDatabase();
    const user = db.prepare("SELECT id, email FROM users WHERE id = ? AND status = 'active'").get(userId);
    if (!user) throw new Error('Utente non trovato');
    
    const app = require('../config/app');
    const planConfig = app.plans[plan];
    if (!planConfig) throw new Error('Piano non valido');
    
    if (!this.stripe) {
      throw new Error('Pagamenti Stripe non configurati');
    }
    
    const appOrigin = new URL(process.env.APP_URL || 'http://localhost:3000').origin;
    const safeReturnUrl = (candidate, fallback) => {
      try { const parsed = new URL(candidate || fallback); return parsed.origin === appOrigin ? parsed.toString() : fallback; } catch { return fallback; }
    };
    const defaultSuccess = `${appOrigin}/dashboard?payment=success`;
    const defaultCancel = `${appOrigin}/prezzi?payment=cancel`;
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
      customer_email: user.email,
      success_url: safeReturnUrl(successUrl, defaultSuccess),
      cancel_url: safeReturnUrl(cancelUrl, defaultCancel),
      metadata: { userId, plan },
      subscription_data: { metadata: { userId, plan } }
    });
    
    return { success: true, sessionId: session.id, url: session.url };
  }

  async handleWebhook(event) {
    const db = getDatabase();
    const eventId = String(event?.id || '').slice(0, 240);
    const eventType = String(event?.type || '').slice(0, 120);
    const eventCreated = Number(event?.created);
    if (!eventId || !eventType || !event?.data?.object || !Number.isInteger(eventCreated) || eventCreated <= 0) {
      throw new Error('Evento Stripe non valido');
    }
    if (db.prepare("SELECT event_id FROM processed_webhook_events WHERE provider = 'stripe' AND event_id = ?").get(eventId)) {
      return { received: true, duplicate: true };
    }

    const activateCheckout = (session) => {
      const userId = String(session.metadata?.userId || '');
      const plan = String(session.metadata?.plan || '');
      const subscription = typeof session.subscription === 'string' ? session.subscription : session.subscription?.id;
      const customer = typeof session.customer === 'string' ? session.customer : session.customer?.id;
      const planConfig = require('../config/app').plans[plan];
      const user = userId && db.prepare("SELECT id FROM users WHERE id = ? AND status = 'active'").get(userId);
      if (!user || !planConfig || session.mode !== 'subscription' || !subscription || !['paid', 'no_payment_required'].includes(session.payment_status)) {
        throw new Error('Checkout Stripe non coerente con un account e un piano attivi');
      }
      const result = db.prepare(`INSERT INTO subscriptions (id, user_id, plan, status, stripe_subscription_id, stripe_customer_id, stripe_event_created)
        VALUES (?, ?, ?, 'active', ?, ?, ?)
        ON CONFLICT(user_id) DO UPDATE SET plan = excluded.plan, status = 'active',
          stripe_subscription_id = excluded.stripe_subscription_id, stripe_customer_id = excluded.stripe_customer_id,
          stripe_event_created = excluded.stripe_event_created, cancelled_at = NULL, updated_at = CURRENT_TIMESTAMP
        WHERE excluded.stripe_event_created >= subscriptions.stripe_event_created`)
        .run(uuidv4(), userId, plan, subscription, customer || null, eventCreated);
      if (!result.changes) return false;
      db.prepare('UPDATE users SET plan = ?, setup_fee_paid = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(plan, userId);
      db.prepare(`INSERT INTO logs (id, user_id, level, action, details)
        VALUES (?, ?, 'info', 'payment_completed', ?)`)
        .run(uuidv4(), userId, JSON.stringify({ plan, checkout_session_id: session.id, stripe_subscription_id: subscription, amount: session.amount_total }));
      return true;
    };

    const isCurrent = (subscription) => eventCreated >= Number(subscription?.stripe_event_created || 0);
    const unixToIso = (value) => Number.isInteger(Number(value)) && Number(value) > 0
      ? new Date(Number(value) * 1000).toISOString()
      : null;
    
    switch (eventType) {
      case 'checkout.session.completed': {
        if (['paid', 'no_payment_required'].includes(event.data.object.payment_status)) activateCheckout(event.data.object);
        break;
      }
      case 'checkout.session.async_payment_succeeded':
        activateCheckout(event.data.object);
        break;
      
      case 'invoice.paid': {
        const invoice = event.data.object;
        const subscriptionRef = invoice.subscription || invoice.parent?.subscription_details?.subscription;
        const subscriptionId = typeof subscriptionRef === 'string' ? subscriptionRef : subscriptionRef?.id;
        const existing = subscriptionId && db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id = ?').get(subscriptionId);
        if (existing && isCurrent(existing)) {
          db.prepare("UPDATE subscriptions SET status = 'active', stripe_event_created = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run(eventCreated, existing.id);
          db.prepare('UPDATE users SET plan = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(existing.plan, existing.user_id);
          db.prepare(`INSERT INTO logs (id, user_id, level, action, details) VALUES (?, ?, 'info', 'invoice_paid', ?)`)
            .run(uuidv4(), existing.user_id, JSON.stringify({ invoice_id: invoice.id, stripe_subscription_id: subscriptionId }));
        }
        break;
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object;
        const subscriptionRef = invoice.subscription || invoice.parent?.subscription_details?.subscription;
        const subscriptionId = typeof subscriptionRef === 'string' ? subscriptionRef : subscriptionRef?.id;
        const existing = subscriptionId && db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id = ?').get(subscriptionId);
        if (existing && isCurrent(existing)) {
          db.prepare("UPDATE subscriptions SET status = 'past_due', stripe_event_created = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
            .run(eventCreated, existing.id);
          db.prepare(`INSERT INTO logs (id, user_id, level, action, details) VALUES (?, ?, 'warning', 'invoice_payment_failed', ?)`)
            .run(uuidv4(), existing.user_id, JSON.stringify({ invoice_id: invoice.id, stripe_subscription_id: subscriptionId }));
        }
        break;
      }

      case 'customer.subscription.updated': {
        const subscription = event.data.object;
        const existing = db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id = ?').get(subscription.id);
        if (existing && isCurrent(existing)) {
          db.prepare(`UPDATE subscriptions SET status = ?, current_period_start = COALESCE(?, current_period_start),
            current_period_end = COALESCE(?, current_period_end), trial_end = COALESCE(?, trial_end),
            stripe_event_created = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
            .run(String(subscription.status || 'unknown').slice(0, 40), unixToIso(subscription.current_period_start),
              unixToIso(subscription.current_period_end), unixToIso(subscription.trial_end), eventCreated, existing.id);
        }
        break;
      }
      
      case 'customer.subscription.deleted': {
        const subscription = event.data.object;
        const existing = db.prepare('SELECT * FROM subscriptions WHERE stripe_subscription_id = ?').get(subscription.id);
        if (existing && isCurrent(existing)) {
          db.prepare('UPDATE subscriptions SET status = "cancelled", cancelled_at = CURRENT_TIMESTAMP, stripe_event_created = ? WHERE id = ?')
            .run(eventCreated, existing.id);
          db.prepare('UPDATE users SET plan = "starter", updated_at = CURRENT_TIMESTAMP WHERE id = ? AND plan = ?').run(existing.user_id, existing.plan);
        }
        break;
      }
    }

    db.prepare(`INSERT INTO processed_webhook_events (provider, event_id, event_type)
      VALUES ('stripe', ?, ?)`).run(eventId, eventType);
    return { received: true };
  }
}

module.exports = new StripeService();
