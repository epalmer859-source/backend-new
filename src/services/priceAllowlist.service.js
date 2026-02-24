/**
 * Server-side Stripe price allowlist. Only prices in product_catalog are accepted.
 * SKU → stripe_price_id + mode (payment | subscription).
 */
const { query } = require('../db');

const MIN_QUANTITY = 1;
const MAX_QUANTITY = 99;

async function getPriceBySku(sku, mode) {
  if (!sku || typeof sku !== 'string' || !mode) return null;
  const r = await query(
    `SELECT stripe_price_id, name FROM product_catalog WHERE sku = $1 AND mode = $2 AND active = true LIMIT 1`,
    [sku.trim(), mode]
  );
  return r.rows[0] || null;
}

/**
 * Resolve line items from SKU + quantity. Returns { lineItems, orderItems, amount_cents } or error.
 * amount_cents is 0 for subscription (Stripe derives from price); for payment we'd need to fetch from Stripe or store.
 */
async function resolveLineItemsFromSkus(skuQuantities, mode) {
  const lineItems = [];
  const orderItems = [];
  let amount_cents = 0;

  for (const { sku, quantity } of skuQuantities) {
    const qty = Math.floor(Number(quantity)) || 0;
    if (qty < MIN_QUANTITY || qty > MAX_QUANTITY) {
      return { error: `Quantity for SKU ${sku} must be between ${MIN_QUANTITY} and ${MAX_QUANTITY}` };
    }
    const row = await getPriceBySku(sku, mode);
    if (!row) {
      return { error: `Unknown or inactive product: ${sku}` };
    }
    lineItems.push({ price: row.stripe_price_id, quantity: qty });
    orderItems.push({
      sku,
      name: row.name,
      qty: qty,
      unit_amount_cents: 0, // Filled from Stripe or catalog if you add amount_cents to product_catalog
    });
  }

  return { lineItems, orderItems, amount_cents };
}

/**
 * Validate that a Stripe price ID is in the allowlist for the given mode.
 */
async function isPriceIdAllowed(priceId, mode) {
  if (!priceId || typeof priceId !== 'string') return false;
  const r = await query(
    `SELECT 1 FROM product_catalog WHERE stripe_price_id = $1 AND mode = $2 AND active = true LIMIT 1`,
    [priceId.trim(), mode]
  );
  return r.rows.length > 0;
}

/**
 * Validate itemsWithPriceIds / priceId against allowlist. Returns { lineItems, orderItems, amount_cents } or error.
 */
async function resolveLineItemsFromPriceIds(itemsWithPriceIds, priceId, mode) {
  const lineItems = [];
  const orderItems = [];
  const amount_cents = 0;

  if (mode === 'subscription' && priceId) {
    const allowed = await isPriceIdAllowed(priceId, 'subscription');
    if (!allowed) return { error: 'Invalid or inactive price for subscription' };
    lineItems.push({ price: priceId, quantity: 1 });
    const r = await query(
      `SELECT sku, name FROM product_catalog WHERE stripe_price_id = $1 AND mode = 'subscription' AND active = true LIMIT 1`,
      [priceId]
    );
    orderItems.push({
      sku: r.rows[0]?.sku || null,
      name: r.rows[0]?.name || 'Subscription',
      qty: 1,
      unit_amount_cents: 0,
    });
    return { lineItems, orderItems, amount_cents };
  }

  if (itemsWithPriceIds?.length) {
    for (const it of itemsWithPriceIds) {
      const qty = Math.floor(Number(it.quantity)) || 0;
      if (qty < MIN_QUANTITY || qty > MAX_QUANTITY) {
        return { error: `Quantity must be between ${MIN_QUANTITY} and ${MAX_QUANTITY}` };
      }
      const allowed = await isPriceIdAllowed(it.priceId, mode);
      if (!allowed) return { error: `Invalid or inactive price: ${it.priceId}` };
      lineItems.push({ price: it.priceId, quantity: qty });
      const r = await query(
        `SELECT sku, name FROM product_catalog WHERE stripe_price_id = $1 AND mode = $2 AND active = true LIMIT 1`,
        [it.priceId, mode]
      );
      orderItems.push({
        sku: r.rows[0]?.sku || null,
        name: r.rows[0]?.name || 'Item',
        qty: qty,
        unit_amount_cents: 0,
      });
    }
    return { lineItems, orderItems, amount_cents };
  }

  return { error: 'Provide itemsWithPriceIds or priceId (subscription) from catalog' };
}

module.exports = {
  MIN_QUANTITY,
  MAX_QUANTITY,
  getPriceBySku,
  resolveLineItemsFromSkus,
  isPriceIdAllowed,
  resolveLineItemsFromPriceIds,
};
