const { z } = require('zod');
const express = require('express');
const { auth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { checkoutLimiter } = require('../middleware/rateLimit');
const orderService = require('../services/order.service');
const stripeService = require('../services/stripe.service');
const priceAllowlistService = require('../services/priceAllowlist.service');
const { findExistingOrderByKey } = require('../utils/idempotency');
const { FRONTEND_URL, isProd } = require('../config/env');
const logger = require('../utils/logger');

const router = express.Router();

const checkoutSchema = z.object({
  mode: z.enum(['payment', 'subscription']),
  idempotencyKey: z.string().optional(),
  items: z.array(z.object({
    name: z.string(),
    price: z.number().positive(),
    quantity: z.number().int().positive(),
    sku: z.string().optional(),
  })).optional(),
  priceId: z.string().optional(),
  itemsWithPriceIds: z.array(z.object({
    priceId: z.string(),
    quantity: z.number().int().positive(),
  })).optional(),
});

router.post('/session', auth, checkoutLimiter, validate(checkoutSchema), async (req, res, next) => {
  try {
    const { mode, idempotencyKey, items, priceId, itemsWithPriceIds } = req.body;
    const stripe = stripeService.getStripe();
    if (!stripe) {
      return res.status(503).json({ error: 'Checkout is not configured' });
    }
    const userId = req.user.id;

    // Production: only allowlist (Stripe price IDs from product_catalog). No raw items.
    if (isProd) {
      if (items?.length > 0) {
        return res.status(400).json({
          error: 'In production use itemsWithPriceIds or priceId (subscription) from catalog.',
        });
      }
      const resolved = await priceAllowlistService.resolveLineItemsFromPriceIds(itemsWithPriceIds, priceId, mode);
      if (resolved.error) {
        return res.status(400).json({ error: resolved.error });
      }
      const { lineItems, orderItems, amount_cents } = resolved;

      if (idempotencyKey) {
        const existing = await findExistingOrderByKey(userId, idempotencyKey);
        if (existing?.stripe_checkout_session_id) {
          const session = await stripe.checkout.sessions.retrieve(existing.stripe_checkout_session_id);
          if (session.url) return res.json({ url: session.url });
        }
      }

      const orderType = mode === 'subscription' ? 'subscription' : 'one_time';
      let orderId, idempotency_key;
      try {
        const result = await orderService.createOrder(userId, {
          amount_cents,
          currency: 'usd',
          idempotency_key: idempotencyKey,
          items: orderItems,
          type: orderType,
        });
        orderId = result.orderId;
        idempotency_key = result.idempotency_key;
      } catch (createErr) {
        if (createErr.code === '23505') {
          return res.status(409).json({ error: 'Duplicate request; use the same idempotency key to get existing session' });
        }
        throw createErr;
      }

      const successUrl = `${FRONTEND_URL}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
      const cancelUrl = `${FRONTEND_URL}/?checkout=cancel`;
      const session = await stripeService.createCheckoutSession({
        mode,
        success_url: successUrl,
        cancel_url: cancelUrl,
        line_items: lineItems,
        metadata: { user_id: userId, order_id: orderId },
        client_reference_id: orderId,
        customer_email: req.user.email,
      });
      await orderService.updateOrderStripeSession(orderId, session.id);
      return res.json({ url: session.url });
    }

    // Development: allow raw items or allowlist
    if (idempotencyKey) {
      const existing = await findExistingOrderByKey(userId, idempotencyKey);
      if (existing?.stripe_checkout_session_id) {
        const session = await stripe.checkout.sessions.retrieve(existing.stripe_checkout_session_id);
        if (session.url) return res.json({ url: session.url });
      }
    }

    let amount_cents = 0;
    let lineItems = [];
    let orderItems = [];

    const useAllowlist = itemsWithPriceIds?.length || (mode === 'subscription' && priceId);
    if (useAllowlist) {
      const resolved = await priceAllowlistService.resolveLineItemsFromPriceIds(itemsWithPriceIds, priceId, mode);
      if (resolved.error) return res.status(400).json({ error: resolved.error });
      lineItems = resolved.lineItems;
      orderItems = resolved.orderItems;
      amount_cents = resolved.amount_cents;
    } else if (items?.length) {
      for (const it of items) {
        const unit = Math.round(Number(it.price) * 100);
        amount_cents += unit * (it.quantity || 1);
        lineItems.push({
          price_data: { currency: 'usd', unit_amount: unit, product_data: { name: it.name } },
          quantity: it.quantity || 1,
        });
      }
      orderItems = items.map((it) => ({
        name: it.name,
        qty: it.quantity || 1,
        unit_amount_cents: Math.round(Number(it.price) * 100),
        sku: it.sku,
      }));
    } else {
      return res.status(400).json({ error: 'Invalid checkout: provide items or itemsWithPriceIds for payment; priceId or itemsWithPriceIds for subscription' });
    }

    const orderType = mode === 'subscription' ? 'subscription' : 'one_time';
    let orderId;
    try {
      const createResult = await orderService.createOrder(userId, {
        amount_cents,
        currency: 'usd',
        idempotency_key: idempotencyKey,
        items: orderItems,
        type: orderType,
      });
      orderId = createResult.orderId;
    } catch (createErr) {
      if (createErr.code === '23505') {
        return res.status(409).json({ error: 'Duplicate request; use the same idempotency key to get existing session' });
      }
      throw createErr;
    }

    const successUrl = `${FRONTEND_URL}/?checkout=success&session_id={CHECKOUT_SESSION_ID}`;
    const cancelUrl = `${FRONTEND_URL}/?checkout=cancel`;
    const session = await stripeService.createCheckoutSession({
      mode,
      success_url: successUrl,
      cancel_url: cancelUrl,
      line_items: lineItems,
      metadata: { user_id: userId, order_id: orderId },
      client_reference_id: orderId,
      customer_email: req.user.email,
    });
    await orderService.updateOrderStripeSession(orderId, session.id);
    res.json({ url: session.url });
  } catch (err) {
    logger.error({ err }, 'checkout session');
    next(err);
  }
});

module.exports = router;
