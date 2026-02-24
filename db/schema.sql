-- Database schema for ASCEND backend (exactly as per backend spec)
-- Run: psql $DATABASE_URL -f db/schema.sql

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- users: id (uuid pk), email (unique), password_hash, name (optional for app), created_at
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- sessions: id (uuid pk), user_id (fk users), expires_at, created_at
CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at);

-- orders: id, user_id, type, status, amount_cents, currency, idempotency_key unique,
--         stripe_checkout_session_id, stripe_payment_intent_id, stripe_subscription_id, stripe_invoice_id, created_at
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL DEFAULT 'one_time' CHECK (type IN ('one_time', 'subscription')),
  status TEXT NOT NULL DEFAULT 'created'
    CHECK (status IN (
      'created', 'pending_payment', 'paid', 'canceled', 'fulfilled', 'shipped', 'completed', 'refunded', 'payment_failed'
    )),
  amount_cents INT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  idempotency_key TEXT UNIQUE,
  stripe_checkout_session_id TEXT UNIQUE,
  stripe_payment_intent_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  stripe_invoice_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_orders_user_id ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_idempotency_key ON orders(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_checkout_session_id ON orders(stripe_checkout_session_id);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_payment_intent_id ON orders(stripe_payment_intent_id);
CREATE INDEX IF NOT EXISTS idx_orders_stripe_subscription_id ON orders(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- order_items: id (uuid pk), order_id (fk orders), sku text, name text, qty int, unit_amount_cents int
CREATE TABLE IF NOT EXISTS order_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  sku TEXT,
  name TEXT NOT NULL,
  qty INT NOT NULL,
  unit_amount_cents INT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

-- subscriptions: id, user_id, stripe_customer_id, stripe_subscription_id unique, status, price_id,
--                current_period_end timestamptz, cancel_at_period_end bool, last_invoice_id, created_at
CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'incomplete',
  price_id TEXT,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  last_invoice_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_stripe_subscription_id ON subscriptions(stripe_subscription_id);

-- webhook_events: id (uuid pk), stripe_event_id text unique, type text, received_at timestamptz,
--                 processed_at timestamptz nullable, status text (ok/error), error text nullable
CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  stripe_event_id TEXT NOT NULL UNIQUE,
  type TEXT NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  processed_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ok', 'error')),
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_stripe_event_id ON webhook_events(stripe_event_id);

-- product_catalog: Stripe price allowlist (SKU -> stripe_price_id, mode). Required for production checkout.
CREATE TABLE IF NOT EXISTS product_catalog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  stripe_price_id TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('payment', 'subscription')),
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(sku, mode)
);
CREATE INDEX IF NOT EXISTS idx_product_catalog_sku_mode ON product_catalog(sku, mode) WHERE active = true;
CREATE INDEX IF NOT EXISTS idx_product_catalog_stripe_price_id ON product_catalog(stripe_price_id, mode) WHERE active = true;
