const { query } = require('../db');

async function findExistingOrderByKey(userId, idempotencyKey) {
  if (!idempotencyKey) return null;
  const r = await query(
    `SELECT id, stripe_checkout_session_id, status FROM orders WHERE user_id = $1 AND idempotency_key = $2 LIMIT 1`,
    [userId, idempotencyKey]
  );
  return r.rows[0] || null;
}

async function findExistingWebhookEvent(stripeEventId) {
  const r = await query(`SELECT id, status FROM webhook_events WHERE stripe_event_id = $1 LIMIT 1`, [stripeEventId]);
  return r.rows[0] || null;
}

module.exports = { findExistingOrderByKey, findExistingWebhookEvent };
