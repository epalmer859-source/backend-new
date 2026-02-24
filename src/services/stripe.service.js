const Stripe = require('stripe');
const { STRIPE_SECRET_KEY } = require('../config/env');
const logger = require('../utils/logger');

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY, { apiVersion: '2023-10-16' }) : null;

async function createCheckoutSession(opts) {
  if (!stripe) throw new Error('Stripe is not configured');
  const line_items = opts.line_items || opts.lineItems || [];
  const session = await stripe.checkout.sessions.create({
    mode: opts.mode || 'payment',
    line_items,
    success_url: opts.success_url || opts.successUrl,
    cancel_url: opts.cancel_url || opts.cancelUrl,
    metadata: opts.metadata || {},
    ...(opts.customer_email || opts.customerEmail ? { customer_email: opts.customer_email || opts.customerEmail } : {}),
    ...(opts.client_reference_id && { client_reference_id: opts.client_reference_id }),
  });
  return session;
}

async function createBillingPortalSession(customerId, returnUrl) {
  if (!stripe) throw new Error('Stripe is not configured');
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: returnUrl,
  });
  return session;
}

async function constructWebhookEvent(payload, signature, secret) {
  if (!stripe) throw new Error('Stripe is not configured');
  return stripe.webhooks.constructEvent(payload, signature, secret);
}

function getStripe() {
  return stripe;
}

module.exports = {
  createCheckoutSession,
  createBillingPortalSession,
  constructWebhookEvent,
  getStripe,
};
