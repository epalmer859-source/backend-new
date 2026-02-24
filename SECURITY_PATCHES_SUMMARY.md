# Security Patches Summary

## 1) Billing portal authorization (CRITICAL) — FIXED

**billing.routes.js**

- **Portal:** Removed all use of client-supplied `customerId`. Stripe customer is resolved from DB via `subscriptionService.getStripeCustomerIdForUser(req.user.id)`, which returns the most recent active/trialing/past_due subscription's `stripe_customer_id`. If none, returns `400` with a generic message: "No billing account found. Subscribe first to manage billing." No leakage of other customers.
- **Checkout:** Removed raw `items` with client-supplied `price`/`quantity`. Billing checkout now accepts only SKU + quantity; line items are built server-side from `product_catalog` (see §5). Quantity validated to `MIN_QUANTITY` (1) and `MAX_QUANTITY` (99).

---

## 2) Billing checkout price manipulation (CRITICAL) — FIXED

**billing.routes.js**

- Billing checkout no longer accepts `price_data` or raw `items` with price/name.
- Request body: `{ mode, idempotencyKey?, items: [{ sku, quantity }] }` with `items.length >= 1`.
- Line items and order items are resolved by `priceAllowlistService.resolveLineItemsFromSkus(items, mode)` using `product_catalog` only.
- Quantity enforced in schema and service (1–99).

---

## 3) Legacy webhook removed (CRITICAL) — FIXED

**webhook.routes.js**

- `POST /webhooks/stripe` now immediately returns **410 Gone** with body `{ error: 'Deprecated webhook endpoint' }`. No event processing, no DB writes.
- Only **POST /api/stripe/webhook** (stripe-webhook.routes.js) should be registered in Stripe. It uses `withTransaction` and `INSERT ... ON CONFLICT (stripe_event_id) DO NOTHING`; `webhook_events.stripe_event_id` is UNIQUE NOT NULL (schema).

---

## 4) createOrder atomic (CRITICAL) — FIXED

**order.service.js**

- `createOrder` runs inside `withTransaction(callback)`: order row and all `order_items` inserts run in one transaction. On any failure, full rollback.
- Throws if `items` is missing or empty: "At least one order item is required." Empty orders are impossible.
- Uses `item.sku ?? null`, `item.name`, `item.qty ?? 1`, `item.unit_amount_cents ?? 0` for inserts.

---

## 5) Stripe price allowlist (HIGH) — ADDED

**New: product_catalog table (migration 003)**

- `product_catalog (id, sku, name, stripe_price_id, mode, active, created_at)` with `UNIQUE(sku, mode)`, `mode IN ('payment','subscription')`.
- **priceAllowlist.service.js:** `getPriceBySku(sku, mode)`, `resolveLineItemsFromSkus(skuQuantities, mode)`, `isPriceIdAllowed(priceId, mode)`, `resolveLineItemsFromPriceIds(itemsWithPriceIds, priceId, mode)`. All resolve against `product_catalog` with `active = true`.

**Checkout logic**

- **checkout.routes.js (API /api/checkout/session):** In production (`isProd`), only allowlist is allowed: raw `items` rejected; `itemsWithPriceIds` / `priceId` validated via `resolveLineItemsFromPriceIds`. In development, raw `items` still allowed for testing; allowlist also supported.
- **billing.routes.js (/billing/checkout-session):** SKU-only; `resolveLineItemsFromSkus` only. Quantity 1–99.

**Seeding:** Insert rows into `product_catalog` for each sellable SKU and its Stripe price ID (and mode). No prices outside this table are accepted in production.

---

## 6) Out-of-order invoice.paid (HIGH) — FIXED

**stripe-webhook.routes.js**

- For **checkout.session.completed** (subscription), after `upsertSubscription` we now reconcile the initial order when `session.payment_status === 'paid'` and `orderId` is present: call `markOrderPaid(orderId, { subscriptionId, invoiceId: sub.latest_invoice.id })` so the order is marked paid even if `invoice.paid` has not been processed yet (or arrived first and sub was missing). `markOrderPaid` is idempotent (WHERE status IN ('pending_payment','created')), so duplicate delivery of either event does not corrupt state.
- Subscription is still created only from checkout metadata (`user_id`); renewal orders remain idempotent by `stripe_invoice_id` UNIQUE.

---

## 7) Idempotency key collision (HIGH) — FIXED

**Schema (migration 003)**

- Dropped `orders_idempotency_key_key` (global UNIQUE on `idempotency_key`).
- Added `orders_user_id_idempotency_key_key` UNIQUE (`user_id`, `idempotency_key`). Same key can be used by different users; duplicate key for the same user returns one row.

**Routes**

- **checkout.routes.js** and **billing.routes.js** catch `err.code === '23505'` (unique violation) and return **409** with message "Duplicate request; use the same idempotency key to get existing session" instead of 500.

---

## 8) Order / user / subscription invariants — VERIFIED

| Invariant | Status |
|-----------|--------|
| `orders.user_id` NOT NULL REFERENCES `users(id)` | In schema |
| `subscriptions.user_id` NOT NULL REFERENCES `users(id)` | In schema |
| `subscriptions.stripe_subscription_id` UNIQUE | In schema |
| `orders.stripe_checkout_session_id` UNIQUE | In schema |
| `orders.stripe_payment_intent_id` UNIQUE | In schema |
| `orders.stripe_invoice_id` UNIQUE | Migration 002 |
| `webhook_events.stripe_event_id` UNIQUE NOT NULL | In schema |

**Migration 004** adds CHECKs: `orders.amount_cents >= 0`, `order_items.qty >= 1`, `order_items.unit_amount_cents >= 0`.

---

## Files changed / added

| Path | Change |
|------|--------|
| `src/routes/billing.routes.js` | Portal: resolve customer from DB. Checkout: SKU-only, allowlist. 409 on duplicate key. |
| `src/routes/webhook.routes.js` | Legacy Stripe handler returns 410 Gone. |
| `src/routes/checkout.routes.js` | Production: allowlist only. 409 on duplicate key. Dev: allowlist or raw items. |
| `src/routes/stripe-webhook.routes.js` | Subscription path: reconcile initial order on checkout.session.completed (out-of-order safe). |
| `src/services/order.service.js` | createOrder wrapped in withTransaction; require ≥1 item. |
| `src/services/subscription.service.js` | Added getStripeCustomerIdForUser(userId). |
| `src/services/priceAllowlist.service.js` | New: allowlist and SKU/priceId resolution. |
| `db/migrations/003_product_catalog_and_idempotency.sql` | product_catalog table; UNIQUE(user_id, idempotency_key). |
| `db/migrations/004_invariant_checks.sql` | CHECKs for amount_cents, qty, unit_amount_cents. |

---

## Invariant guarantees after patch

- **Price:** In production, only prices in `product_catalog` (and correct mode) are accepted. Billing checkout is SKU-only.
- **Portal:** Only the authenticated user's own Stripe customer (from their subscription) can open the billing portal.
- **Webhooks:** Single active handler; event idempotency and transaction semantics preserved.
- **Orders:** No empty orders; order + items are created atomically.
- **Idempotency:** Per-user key; duplicate key returns 409 and does not crash the server.
- **Subscription lifecycle:** Initial order is marked paid either from invoice.paid or from checkout.session.completed; out-of-order delivery does not leave the order stuck in pending.

---

## Remaining risks

1. **product_catalog** must be populated and kept in sync with Stripe (price IDs, active flag). Wrong or stale rows can block valid checkouts or allow wrong prices if misconfigured.
2. **Rate limiting** is in-memory; multi-instance deployments need a shared store (e.g. Redis) for consistent limits.
3. **GET /api/orders/by-session/:sessionId** remains unauthenticated; anyone with the session ID can read order status. Consider requiring auth and verifying the order belongs to the user, or keep as-is and rely on session ID entropy and rate limit.
4. **Stripe API failure** during checkout (e.g. session create) after order is created leaves a pending order; consider a cleanup job or idempotent retry with the same idempotency key.
