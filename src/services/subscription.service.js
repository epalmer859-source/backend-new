const { query } = require('../db');
const { v4: uuidv4 } = require('uuid');

function getQuery(client) {
  return client ? client.query.bind(client) : query;
}

async function upsertSubscription(userId, { stripeSubscriptionId, stripeCustomerId, priceId, currentPeriodEnd, status = 'active' }, client) {
  const q = getQuery(client);
  const r = await q(
    `INSERT INTO subscriptions (id, user_id, stripe_customer_id, stripe_subscription_id, status, price_id, current_period_end)
     VALUES (gen_random_uuid(), $1, $2, $3, $4, $5, $6)
     ON CONFLICT (stripe_subscription_id) DO UPDATE SET
       status = EXCLUDED.status,
       price_id = COALESCE(EXCLUDED.price_id, subscriptions.price_id),
       current_period_end = COALESCE(EXCLUDED.current_period_end, subscriptions.current_period_end)
     RETURNING id`,
    [userId, stripeCustomerId || null, stripeSubscriptionId, status, priceId || null, currentPeriodEnd || null]
  );
  return r.rows[0];
}

async function updateSubscriptionStatus(stripeSubscriptionId, status, client) {
  const q = getQuery(client);
  await q(
    `UPDATE subscriptions SET status = $1 WHERE stripe_subscription_id = $2`,
    [status, stripeSubscriptionId]
  );
}

async function setSubscriptionLastInvoice(stripeSubscriptionId, lastInvoiceId, client) {
  const q = getQuery(client);
  await q(
    `UPDATE subscriptions SET last_invoice_id = $1 WHERE stripe_subscription_id = $2`,
    [lastInvoiceId, stripeSubscriptionId]
  );
}

async function getSubscriptionByStripeId(stripeSubscriptionId, client) {
  const q = getQuery(client);
  const r = await q(
    `SELECT id, user_id, stripe_subscription_id, status, current_period_end FROM subscriptions WHERE stripe_subscription_id = $1 LIMIT 1`,
    [stripeSubscriptionId]
  );
  return r.rows[0] || null;
}

/**
 * Resolve Stripe customer ID for billing portal. Picks most recent active/trialing/past_due subscription for user.
 * Returns null if none — do not leak existence of other customers.
 */
async function getStripeCustomerIdForUser(userId, client) {
  const q = getQuery(client);
  const r = await q(
    `SELECT stripe_customer_id FROM subscriptions
     WHERE user_id = $1 AND stripe_customer_id IS NOT NULL
       AND status IN ('active', 'trialing', 'past_due')
     ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return r.rows[0]?.stripe_customer_id || null;
}

/**
 * Create a renewal order for a subscription invoice. Idempotent by stripe_invoice_id:
 * if an order already exists with that invoice id (UNIQUE constraint), skip creation.
 */
async function createRenewalOrder(userId, { amount_cents, stripeSubscriptionId, stripeInvoiceId }, client) {
  if (!stripeInvoiceId) return null;
  const q = getQuery(client);
  const orderId = uuidv4();
  const r = await q(
    `INSERT INTO orders (id, user_id, status, amount_cents, currency, type, stripe_subscription_id, stripe_invoice_id)
     VALUES ($1, $2, 'paid', $3, 'usd', 'subscription', $4, $5)
     ON CONFLICT (stripe_invoice_id) DO NOTHING
     RETURNING id`,
    [orderId, userId, amount_cents || 0, stripeSubscriptionId || null, stripeInvoiceId]
  );
  return r.rows[0] ? r.rows[0].id : null;
}

module.exports = {
  upsertSubscription,
  updateSubscriptionStatus,
  setSubscriptionLastInvoice,
  getSubscriptionByStripeId,
  getStripeCustomerIdForUser,
  createRenewalOrder,
};
