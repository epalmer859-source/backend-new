const express = require('express');
const { query, withTransaction } = require('../db');
const stripeService = require('../services/stripe.service');
const orderService = require('../services/order.service');
const subscriptionService = require('../services/subscription.service');
const { STRIPE_WEBHOOK_SECRET } = require('../config/env');
const logger = require('../utils/logger');

const router = express.Router();

router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  if (!STRIPE_WEBHOOK_SECRET || !sig) {
    return res.status(400).send('Webhook secret or signature missing');
  }
  let event;
  try {
    event = stripeService.constructWebhookEvent(req.body, sig, STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    logger.warn({ err: err.message }, 'Webhook signature verification failed');
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Idempotency: check outside transaction to avoid unnecessary work on duplicate delivery.
  const existing = await query(
    `SELECT id, status FROM webhook_events WHERE stripe_event_id = $1 LIMIT 1`,
    [event.id]
  );
  if (existing.rows.length > 0) {
    logger.info({ eventId: event.id, type: event.type }, 'Webhook event skipped (already processed)');
    return res.status(200).send('OK');
  }

  try {
    await withTransaction(async (client) => {
      // Insert event inside transaction so we commit only after handlers succeed.
      const insert = await client.query(
        `INSERT INTO webhook_events (stripe_event_id, type, status) VALUES ($1, $2, 'pending')
         ON CONFLICT (stripe_event_id) DO NOTHING RETURNING id`,
        [event.id, event.type]
      );
      if (insert.rowCount === 0) {
        logger.info({ eventId: event.id, type: event.type }, 'Webhook event skipped (race: duplicate insert)');
        return;
      }

      const logCtx = { eventId: event.id, type: event.type };

      switch (event.type) {
        case 'checkout.session.completed': {
          const session = event.data.object;
          const orderId = session.metadata?.order_id || session.client_reference_id;
          logger.info({ ...logCtx, orderId, subscriptionId: session.subscription || null }, 'Webhook checkout.session.completed');

          // Subscription: upsert subscription, then reconcile initial order (handles out-of-order invoice.paid).
          if (session.subscription && session.metadata?.user_id) {
            const stripe = stripeService.getStripe();
            if (stripe) {
              const sub = await stripe.subscriptions.retrieve(session.subscription, { expand: ['latest_invoice'] });
              await subscriptionService.upsertSubscription(session.metadata.user_id, {
                stripeSubscriptionId: session.subscription,
                stripeCustomerId: session.customer,
                priceId: sub.items?.data?.[0]?.price?.id,
                currentPeriodEnd: sub.current_period_end ? new Date(sub.current_period_end * 1000) : null,
                status: sub.status,
              }, client);
              // Reconcile initial order: if invoice.paid arrived before us it already marked paid; else mark now (idempotent).
              if (session.payment_status === 'paid' && orderId) {
                const invoiceId = sub.latest_invoice?.id || (typeof sub.latest_invoice === 'string' ? sub.latest_invoice : null);
                const r = await orderService.markOrderPaid(orderId, {
                  paymentIntentId: null,
                  subscriptionId: session.subscription,
                  invoiceId: invoiceId || undefined,
                }, client);
                if (r.rowCount > 0) {
                  logger.info({ eventId: event.id, orderId }, 'Initial subscription order marked paid (checkout.session.completed)');
                }
              }
            }
            break;
          }

          // One-time payment: mark order paid (safe transition pending_payment -> paid only).
          if (session.payment_status === 'paid' && orderId) {
            const r = await orderService.markOrderPaid(orderId, {
              paymentIntentId: session.payment_intent || null,
              subscriptionId: null,
              invoiceId: null,
            }, client);
            if (r.rowCount === 0) {
              logger.warn({ eventId: event.id, orderId }, 'Order already paid or invalid; prevented status downgrade');
            }
          }
          break;
        }

        case 'invoice.paid': {
          const invoice = event.data.object;
          const subscriptionId = invoice.subscription;
          logger.info({ ...logCtx, subscriptionId, invoiceId: invoice.id }, 'Webhook invoice.paid');

          if (subscriptionId) {
            await subscriptionService.setSubscriptionLastInvoice(subscriptionId, invoice.id, client);
            const sub = await subscriptionService.getSubscriptionByStripeId(subscriptionId, client);
            if (!sub) break;

            // Prefer marking initial subscription order as paid here (single source of truth for subscription payments).
            const pendingOrder = await orderService.getPendingOrderByStripeSubscriptionId(subscriptionId, client);
            if (pendingOrder) {
              const r = await orderService.markOrderPaid(pendingOrder.id, {
                paymentIntentId: null,
                subscriptionId,
                invoiceId: invoice.id,
              }, client);
              if (r.rowCount === 0) {
                logger.warn({ eventId: event.id, orderId: pendingOrder.id }, 'Initial order already paid; skipped');
              }
            } else {
              // Renewal: create order idempotent by stripe_invoice_id (UNIQUE constraint).
              const renewalId = await subscriptionService.createRenewalOrder(sub.user_id, {
                amount_cents: invoice.amount_paid || 0,
                stripeSubscriptionId: subscriptionId,
                stripeInvoiceId: invoice.id,
              }, client);
              if (renewalId) {
                logger.info({ eventId: event.id, orderId: renewalId, invoiceId: invoice.id }, 'Renewal order created');
              } else {
                logger.info({ eventId: event.id, invoiceId: invoice.id }, 'Renewal order already exists (idempotent skip)');
              }
            }
          }
          break;
        }

        case 'invoice.payment_failed': {
          const invoice = event.data.object;
          if (invoice.subscription) {
            logger.info({ ...logCtx, subscriptionId: invoice.subscription }, 'Webhook invoice.payment_failed');
            await subscriptionService.updateSubscriptionStatus(invoice.subscription, 'past_due', client);
          }
          break;
        }

        case 'charge.refunded':
        case 'charge.refund.updated': {
          const charge = event.data.object;
          const paymentIntent = charge.payment_intent;
          logger.info({ ...logCtx, paymentIntent }, 'Webhook charge.refunded/updated');
          if (paymentIntent) {
            const r = await orderService.markOrderRefundedByPaymentIntent(paymentIntent, client);
            if (r.rowCount > 0) {
              logger.info({ orderId: r.rows[0].id }, 'Order marked refunded');
            } else {
              logger.info({ paymentIntent }, 'No paid order for this payment_intent; skipped (idempotent)');
            }
          }
          break;
        }

        default:
          logger.debug({ ...logCtx }, 'Unhandled webhook event type');
      }

      await client.query(
        `UPDATE webhook_events SET processed_at = now(), status = 'ok' WHERE stripe_event_id = $1`,
        [event.id]
      );
    });
  } catch (err) {
    logger.error({ err, eventId: event.id, type: event.type }, 'Webhook processing error');
    // Transaction rolled back, so webhook_events row was not committed; no need to update status.
    return res.status(500).send('Webhook handler error');
  }

  res.status(200).send('OK');
});

module.exports = router;
