-- Add order type and subscription/invoice fields for Stripe Checkout + webhooks
-- Run: psql $DATABASE_URL -f db/migrations/001_orders_type_and_stripe.sql

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS type TEXT NOT NULL DEFAULT 'one_time'
    CHECK (type IN ('one_time', 'subscription')),
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_invoice_id TEXT;

CREATE INDEX IF NOT EXISTS idx_orders_stripe_subscription_id ON orders(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
