-- Enforce invariant CHECKs. All FKs and UNIQUEs already in schema/migrations 001-003.
-- Run after 003_product_catalog_and_idempotency.sql

-- orders.amount_cents non-negative
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'orders_amount_cents_non_negative') THEN
    ALTER TABLE orders ADD CONSTRAINT orders_amount_cents_non_negative CHECK (amount_cents >= 0);
  END IF;
END $$;

-- order_items.qty positive
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_qty_positive') THEN
    ALTER TABLE order_items ADD CONSTRAINT order_items_qty_positive CHECK (qty >= 1);
  END IF;
END $$;

-- order_items.unit_amount_cents non-negative
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'order_items_unit_amount_non_negative') THEN
    ALTER TABLE order_items ADD CONSTRAINT order_items_unit_amount_non_negative CHECK (unit_amount_cents >= 0);
  END IF;
END $$;
