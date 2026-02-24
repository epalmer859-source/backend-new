const { v4: uuidv4 } = require('uuid');
const { query, withTransaction } = require('../db');
const { findExistingOrderByKey } = require('../utils/idempotency');

const ORDER_STATUS = {
  created: 'created',
  pending_payment: 'pending_payment',
  paid: 'paid',
  canceled: 'canceled',
  fulfilled: 'fulfilled',
  shipped: 'shipped',
  completed: 'completed',
  refunded: 'refunded',
  payment_failed: 'payment_failed',
};

/** Use client.query in a transaction, or global query when client is omitted. */
function getQuery(client) {
  return client ? client.query.bind(client) : query;
}

/**
 * Create order and order_items in a single transaction. At least one item required.
 * Rollback on any failure. Prevents empty orders.
 */
async function createOrder(userId, { amount_cents, currency = 'usd', idempotency_key, items, type = 'one_time' }) {
  const normalizedItems = Array.isArray(items) ? items.filter((i) => i != null) : [];
  if (normalizedItems.length === 0) {
    throw new Error('At least one order item is required');
  }
  const orderId = uuidv4();
  const key = idempotency_key || uuidv4();

  await withTransaction(async (client) => {
    await client.query(
      `INSERT INTO orders (id, user_id, status, amount_cents, currency, idempotency_key, type)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [orderId, userId, ORDER_STATUS.pending_payment, amount_cents, currency, key, type]
    );
    for (const item of normalizedItems) {
      await client.query(
        `INSERT INTO order_items (order_id, sku, name, qty, unit_amount_cents) VALUES ($1, $2, $3, $4, $5)`,
        [orderId, item.sku ?? null, item.name, item.qty ?? 1, item.unit_amount_cents ?? 0]
      );
    }
  });

  return { orderId, idempotency_key: key };
}

async function getOrdersByUser(userId, limit = 50) {
  const r = await query(
    `SELECT o.id, o.status, o.amount_cents, o.currency, o.stripe_checkout_session_id, o.created_at, o.type
     FROM orders o WHERE o.user_id = $1 ORDER BY o.created_at DESC LIMIT $2`,
    [userId, limit]
  );
  const orders = r.rows;
  for (const o of orders) {
    const items = await query(`SELECT sku, name, qty, unit_amount_cents FROM order_items WHERE order_id = $1`, [o.id]);
    o.items = items.rows;
  }
  return orders;
}

async function getOrderById(userId, orderId) {
  const r = await query(
    `SELECT id, status, amount_cents, currency, stripe_checkout_session_id, created_at, type
     FROM orders WHERE id = $1 AND user_id = $2 LIMIT 1`,
    [orderId, userId]
  );
  if (r.rows.length === 0) return null;
  const o = r.rows[0];
  const items = await query(`SELECT sku, name, qty, unit_amount_cents FROM order_items WHERE order_id = $1`, [o.id]);
  o.items = items.rows;
  return o;
}

async function updateOrderStripeSession(orderId, sessionId) {
  await query(
    `UPDATE orders SET stripe_checkout_session_id = $1 WHERE id = $2`,
    [sessionId, orderId]
  );
}

/**
 * Mark order as paid. Safe state machine: only transitions pending_payment/created -> paid.
 * Never downgrades status (idempotent under retries; no-op if already paid).
 */
async function markOrderPaid(orderId, paymentIntentIdOrOpts, client) {
  const q = getQuery(client);
  const opts = typeof paymentIntentIdOrOpts === 'string'
    ? { paymentIntentId: paymentIntentIdOrOpts }
    : (paymentIntentIdOrOpts || {});
  const { paymentIntentId, subscriptionId, invoiceId } = opts;
  const r = await q(
    `UPDATE orders SET status = $1, stripe_payment_intent_id = COALESCE($2, stripe_payment_intent_id),
     stripe_subscription_id = COALESCE($3, stripe_subscription_id), stripe_invoice_id = COALESCE($4, stripe_invoice_id)
     WHERE id = $5 AND status IN ('pending_payment', 'created')`,
    [ORDER_STATUS.paid, paymentIntentId || null, subscriptionId || null, invoiceId || null, orderId]
  );
  return r;
}

/**
 * Mark order as refunded. Safe: only transition paid -> refunded (never downgrade).
 */
async function markOrderRefunded(orderId, client) {
  const q = getQuery(client);
  await q(`UPDATE orders SET status = $1 WHERE id = $2 AND status = $3`, [ORDER_STATUS.refunded, orderId, ORDER_STATUS.paid]);
}

/**
 * Mark order as refunded by Stripe payment_intent id. Safe: only paid -> refunded (idempotent if already refunded).
 */
async function markOrderRefundedByPaymentIntent(paymentIntentId, client) {
  const q = getQuery(client);
  const r = await q(
    `UPDATE orders SET status = $1 WHERE stripe_payment_intent_id = $2 AND status = $3 RETURNING id`,
    [ORDER_STATUS.refunded, paymentIntentId, ORDER_STATUS.paid]
  );
  return r;
}

async function getOrderByStripeSessionId(sessionId, client) {
  const q = getQuery(client);
  const r = await q(`SELECT id, user_id, status FROM orders WHERE stripe_checkout_session_id = $1 LIMIT 1`, [sessionId]);
  return r.rows[0] || null;
}

/** Find initial subscription order still pending (for marking paid on first invoice.paid). */
async function getPendingOrderByStripeSubscriptionId(stripeSubscriptionId, client) {
  const q = getQuery(client);
  const r = await q(
    `SELECT id FROM orders WHERE stripe_subscription_id = $1 AND status IN ('pending_payment', 'created') ORDER BY created_at ASC LIMIT 1`,
    [stripeSubscriptionId]
  );
  return r.rows[0] || null;
}

async function getLatestOrderByUser(userId) {
  const r = await query(
    `SELECT id, status, amount_cents, created_at FROM orders WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
    [userId]
  );
  return r.rows[0] || null;
}

module.exports = {
  ORDER_STATUS,
  createOrder,
  getOrdersByUser,
  getOrderById,
  updateOrderStripeSession,
  markOrderPaid,
  markOrderRefunded,
  markOrderRefundedByPaymentIntent,
  getOrderByStripeSessionId,
  getPendingOrderByStripeSubscriptionId,
  getLatestOrderByUser,
  findExistingOrderByKey,
};
