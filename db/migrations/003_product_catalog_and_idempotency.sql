-- Product catalog for Stripe price allowlist (SKU -> stripe_price_id, mode).
-- Idempotency: UNIQUE (user_id, idempotency_key) so duplicate key returns 409 instead of 500.

-- product_catalog: server-side allowlist for Stripe price IDs
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

-- Replace global UNIQUE(idempotency_key) with per-user UNIQUE(user_id, idempotency_key)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_idempotency_key_key') THEN
    ALTER TABLE orders DROP CONSTRAINT orders_idempotency_key_key;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_user_id_idempotency_key_key') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_user_id_idempotency_key_key UNIQUE (user_id, idempotency_key);
  END IF;
END $$;

-- Drop old index on idempotency_key if it was unique (index may remain from UNIQUE)
DROP INDEX IF EXISTS idx_orders_idempotency_key;
CREATE INDEX IF NOT EXISTS idx_orders_user_id_idempotency_key ON orders(user_id, idempotency_key);
