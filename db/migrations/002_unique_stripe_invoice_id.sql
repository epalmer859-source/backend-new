-- Prevent duplicate renewal orders: UNIQUE on stripe_invoice_id.
-- Ensures invoice.paid handler is idempotent (ON CONFLICT DO NOTHING).
-- PostgreSQL allows multiple NULLs; only one row per non-null stripe_invoice_id.
-- Run: psql $DATABASE_URL -f db/migrations/002_unique_stripe_invoice_id.sql

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_stripe_invoice_id_key'
  ) THEN
    ALTER TABLE orders ADD CONSTRAINT orders_stripe_invoice_id_key UNIQUE (stripe_invoice_id);
  END IF;
END $$;
