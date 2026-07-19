const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const dbFile = path.join('/tmp', `wes-stripe-${process.pid}.db`);
process.env.DB_PATH = dbFile;

test('signed Stripe event handling is idempotent and validates account metadata', async (t) => {
  t.after(() => { try { fs.unlinkSync(dbFile); } catch {} });
  const db = await require('../app/config/database').initDatabase();
  db.prepare('INSERT INTO users (id, email, password, company_name) VALUES (?, ?, ?, ?)')
    .run('stripe-user', 'billing@example.test', 'hash', 'Billing Test');
  const stripe = require('../app/services/stripe');
  const event = {
    id: 'evt_checkout_once', type: 'checkout.session.completed', created: 1_700_000_000,
    data: { object: {
      id: 'cs_test_safe', mode: 'subscription', payment_status: 'paid', amount_total: 159700,
      subscription: 'sub_test_safe', customer: 'cus_test_safe', metadata: { userId: 'stripe-user', plan: 'pro' }
    } }
  };
  const first = await stripe.handleWebhook(event);
  const duplicate = await stripe.handleWebhook(event);
  assert.deepEqual(first, { received: true });
  assert.deepEqual(duplicate, { received: true, duplicate: true });
  assert.equal(db.prepare('SELECT plan FROM users WHERE id = ?').get('stripe-user').plan, 'pro');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM subscriptions WHERE user_id = ?').get('stripe-user').count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM processed_webhook_events WHERE provider = 'stripe'").get().count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM logs WHERE action = 'payment_completed'").get().count, 1);

  await stripe.handleWebhook({ id: 'evt_subscription_end', type: 'customer.subscription.deleted', created: 1_700_000_200, data: { object: { id: 'sub_test_safe' } } });
  assert.equal(db.prepare('SELECT plan FROM users WHERE id = ?').get('stripe-user').plan, 'starter');
  assert.equal(db.prepare('SELECT status FROM subscriptions WHERE user_id = ?').get('stripe-user').status, 'cancelled');

  await stripe.handleWebhook({
    id: 'evt_old_invoice_arrived_late', type: 'invoice.paid', created: 1_700_000_100,
    data: { object: { id: 'in_old', subscription: 'sub_test_safe' } }
  });
  assert.equal(db.prepare('SELECT plan FROM users WHERE id = ?').get('stripe-user').plan, 'starter');
  assert.equal(db.prepare('SELECT status FROM subscriptions WHERE user_id = ?').get('stripe-user').status, 'cancelled');
});
