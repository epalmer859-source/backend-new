const { z } = require('zod');
const express = require('express');
const { auth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { checkoutLimiter } = require('../middleware/rateLimit');
const orderService = require('../services/order.service');
const stripeService = require('../services/stripe.service');
const subscriptionService = require('../services/subscription.service');
const priceAllowlistService = require('../services/priceAllowlist.service');
const { findExistingOrderByKey } = require('../utils/idempotency');
const { FRONTEND_ORIGIN } = require('../config/env');
const logger = require('../utils/logger');

const router = express.Router();

// Billing checkout: SKU-only, server-resolved prices. No client-supplied price_data or raw items.
const billingCheckoutSchema = z.object({
  mode: z.enum(['payment', 'subscription']),
  idempotencyKey: z.string().optional(),
  items: z.array(z.object({
    sku: z.string().min(1),
    quantity: z.number().int().min(priceAllowlistService.MIN_QUANTITY).max(priceAllowlistService.MAX_QUANTITY),
  })).min(1),
});

router.post('/checkout-session', auth, checkoutLimiter, validate(billingCheckoutSchema), async (req, res, next) => {
  try {
    const stripe = stripeService.getStripe();
    if (!stripe) {
      return res.status(503).json({ error: 'Checkout is not configured' });
    }
    const { mode, idempotencyKey, items } = req.body;
    const userId = req.user.id;

    if (idempotencyKey) {
      const existing = await findExistingOrderByKey(userId, idempotencyKey);
      if (existing?.stripe_checkout_session_id) {
        const session = await stripe.checkout.sessions.retrieve(existing.stripe_checkout_session_id);
        if (session.url) {
          return res.json({ url: session.url });
        }
      }
    }

    const resolved = await priceAllowlistService.resolveLineItemsFromSkus(items, mode);
    if (resolved.error) {
      return res.status(400).json({ error: resolved.error });
    }
    const { lineItems, orderItems, amount_cents } = resolved;

    const orderType = mode === 'subscription' ? 'subscription' : 'one_time';
    const { orderId, idempotency_key } = await orderService.createOrder(userId, {
      amount_cents,
      currency: 'usd',
      idempotency_key: idempotencyKey,
      items: orderItems,
      type: orderType,
    });

    const baseUrl = FRONTEND_ORIGIN;
    const session = await stripeService.createCheckoutSession({
      mode,
      success_url: `${baseUrl}/?checkout=success&order_id=${orderId}`,
      cancel_url: `${baseUrl}/?checkout=cancel`,
      lineItems,
      metadata: { user_id: userId, order_id: orderId },
      customerEmail: req.user.email,
    });

    await orderService.updateOrderStripeSession(orderId, session.id);
    res.json({ url: session.url });
  } catch (err) {
    if (err.code === '23505') {
      return res.status(409).json({ error: 'Duplicate request; use the same idempotency key to get existing session' });
    }
    logger.error({ err }, 'billing checkout-session');
    next(err);
  }
});

// Billing portal: resolve Stripe customer from DB by req.user.id. No client-supplied customerId.
router.post('/portal', auth, async (req, res, next) => {
  try {
    const stripe = stripeService.getStripe();
    if (!stripe) {
      return res.status(503).json({ error: 'Billing portal is not configured' });
    }
    const userId = req.user.id;
    const customerId = await subscriptionService.getStripeCustomerIdForUser(userId);
    if (!customerId) {
      return res.status(400).json({ error: 'No billing account found. Subscribe first to manage billing.' });
    }
    const returnUrl = `${FRONTEND_ORIGIN}/`;
    const session = await stripeService.createBillingPortalSession(customerId, returnUrl);
    if (!session?.url) {
      return res.status(500).json({ error: 'Could not create portal session' });
    }
    res.json({ url: session.url });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
