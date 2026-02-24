# Adversarial Security Audit — Cart / Checkout / Stripe Backend

**Scope:** Backend (`backend/`), Stripe webhooks, order/subscription lifecycle, auth, DB.  
**Assumptions:** Malicious users, Stripe retries/races/out-of-order events, client payload tampering, concurrency/replay, partial DB failure/restarts, subscription/refund abuse.

---

## 1. Price Integrity

### Can a user manipulate price, quantity, currency, or product?

**YES — in multiple code paths.**

- **`/api/checkout/session`** (checkout.routes.js): When `isProd` is false (default: `NODE_ENV !== 'production'`), the server accepts `items: [{ name, price, quantity }]` and builds Stripe `line_items` from client-supplied `price` and `quantity`. Attacker sends `price: 0.01`, `quantity: 1000` → order created and Stripe session created with that amount.
- **`/billing/checkout-session`** (billing.routes.js): **No `isProd` check.** It always accepts `items` with client-supplied `price` and `quantity`. Same exploit: arbitrary price/quantity. Currency is hardcoded `usd` in both; product name is client-controlled (cosmetic only).

**Exploit path (price manipulation):**  
`POST /billing/checkout-session` with `Cookie: sid=<valid_session>`, body: `{ "mode": "payment", "items": [{ "name": "X", "price": 0.01, "quantity": 1 }] }` → Stripe Checkout for $0.01; after payment, order is marked paid with that amount.

### Can a test price be used in production?

- If the app is run with `NODE_ENV=production` and only `/api/checkout/session` is used, test prices are not directly injectable via `items` (production path requires `itemsWithPriceIds` / `priceId`).
- **But** Stripe price IDs are **not** validated against an allowlist. A live Stripe account can have a $0.01 “test” price in live mode; attacker sends `itemsWithPriceIds: [{ priceId: "price_that_live_penny_price", quantity: 1 }]` and pays a penny for a product that should cost more.

### Can a subscription price be swapped for a one-time price?

- Server sends `line_items` and `mode` to Stripe. For `mode: 'payment'`, Stripe expects one-time prices; for `mode: 'subscription'`, subscription prices. Passing a subscription price ID in payment mode would be rejected by Stripe API (not validated in app code). So swap is limited by Stripe’s API, but the app does not enforce an allowlist or type check.

### Are Stripe price IDs validated against an allowlist?

**NO.** There is no allowlist, no server-side fetch of price from Stripe to verify amount/currency/type. Any price ID belonging to the same Stripe account is accepted when using `itemsWithPriceIds` / `priceId`.

**Summary:** Price integrity is broken when (1) `isProd` is false, or (2) `/billing/checkout-session` is used, or (3) in production with a non-allowlisted (e.g. low-value) price ID.

---

## 2. Order Ownership & Account Binding

### Can an order be attached to the wrong user?

**No.** Orders are created with `user_id` from `req.user.id` (session). Webhook sets `metadata: { user_id, order_id }` server-side. Subscription upsert uses `session.metadata.user_id`. There is no client-supplied `user_id` for order creation or binding.

### Can a user query another user's order?

**No for authenticated order list/detail.**  
`GET /orders` and `GET /orders/:id` use `orderService.getOrdersByUser(req.user.id)` and `getOrderById(req.user.id, orderId)` — both filter by `user_id`. So users cannot list or fetch another user’s order by ID.

### Are session IDs or invoice IDs enumerable?

- **Session IDs:** `GET /api/orders/by-session/:sessionId` returns `{ status }` for any valid Stripe session ID. Session IDs match `cs_(test|live)_[A-Za-z0-9]+` and are long random strings — not practically enumerable. No auth; anyone with the session ID (e.g. from logs, referrer, shared link) can see that order’s status.
- **Order IDs:** UUIDs; same as above — not enumerable; order detail requires auth and `user_id` match.
- **Invoice IDs:** Only used in webhooks and DB; not exposed on a per-invoice endpoint.

### Is there any endpoint that leaks order state?

- **`/api/orders/by-session/:sessionId`** returns `order.status` to anyone who knows the session ID (no auth). So “order exists and its status” is leaked to holders of the session ID. No other order state (user_id, amount, etc.) is returned.

---

## 3. Webhook Idempotency & Race Conditions

### Two webhook implementations (critical)

There are **two** Stripe webhook handlers:

1. **`POST /webhooks/stripe`** (webhook.routes.js)  
2. **`POST /api/stripe/webhook`** (stripe-webhook.routes.js)

Only one should be configured in Stripe. The findings below distinguish them.

### Can duplicate webhook events create duplicate orders?

- **`/api/stripe/webhook`:** Idempotency is enforced: (1) SELECT on `webhook_events` by `stripe_event_id` outside transaction; (2) inside transaction, `INSERT INTO webhook_events ... ON CONFLICT (stripe_event_id) DO NOTHING RETURNING id` — second concurrent delivery gets no row and exits. Order creation/mark-paid only runs for the first. Renewal orders use `INSERT ... ON CONFLICT (stripe_invoice_id) DO NOTHING`. So duplicate events do **not** create duplicate orders.
- **`/webhooks/stripe`:** No transaction. `findExistingWebhookEvent` then `INSERT INTO webhook_events` — two concurrent requests can both see “no existing” and both insert; one will hit UNIQUE on `stripe_event_id` and throw. The other commits. Then both may proceed to handler logic (one after 500). So duplicate handling is possible (race), and the failed insert path can leave inconsistent state (event not recorded but handler run). **Unsafe** if this URL is used.

### Can out-of-order events corrupt order status?

- **invoice.paid before checkout.session.completed (subscription):** In `stripe-webhook.routes.js`, subscription flow is: `checkout.session.completed` → upsert subscription and (for one-time) mark order paid; `invoice.paid` → mark initial subscription order paid or create renewal. If `invoice.paid` is delivered first, `getSubscriptionByStripeId` can return null (subscription not yet upserted), so the handler skips marking the initial order paid and skips creating a renewal. When `checkout.session.completed` later runs, it only upserts the subscription; it does **not** mark the initial subscription order paid (that’s left to `invoice.paid`). So the initial subscription order can remain in `pending_payment` forever. **Corruption:** subscription is active in Stripe and in `subscriptions` table, but the corresponding order is never marked paid.

### Can concurrent webhook deliveries cause state drift?

- With **`/api/stripe/webhook`**, the transaction and `ON CONFLICT` on `webhook_events` prevent double processing. With **`/webhooks/stripe`**, the race above can cause one event to be processed twice (or one to fail after partial processing), so state can drift.

### Are all transitions guarded at the SQL level?

- **markOrderPaid:** `WHERE id = $5 AND status IN ('pending_payment', 'created')` — guarded; no paid → paid downgrade.
- **markOrderRefundedByPaymentIntent:** `WHERE stripe_payment_intent_id = $2 AND status = $3` with `$3 = 'paid'` — only paid → refunded.
- **Refund in webhook.routes.js:** `UPDATE orders SET status = 'refunded' WHERE stripe_payment_intent_id = $1` — **no** `AND status = 'paid'`. Idempotent in practice because only one row has that payment_intent (UNIQUE), but not transition-safe by design.

### Are Stripe event IDs uniquely constrained?

**Yes.** Schema: `webhook_events.stripe_event_id TEXT NOT NULL UNIQUE`. So at the DB level, duplicate event IDs cannot be stored. The hardened handler also uses `ON CONFLICT (stripe_event_id) DO NOTHING` inside a transaction to drive idempotent behavior.

---

## 4. Order State Machine Safety

### Can paid orders be downgraded?

**No.** `markOrderPaid` only updates when `status IN ('pending_payment', 'created')`. There is no other code path that sets a paid order back to a lower status.

### Can refunded orders be marked paid again?

**No.** The same `WHERE status IN ('pending_payment', 'created')` prevents marking an already paid or refunded order as paid again.

### Are transitions enforced in SQL WHERE clauses?

**Yes** for the main handlers in stripe-webhook.routes.js and order.service.js: paid and refund transitions use the guards above. The legacy webhook.routes.js refund update does not include `status = 'paid'` in the WHERE clause (weaker).

### Are there any transitions that are not idempotent?

- Mark paid: idempotent (no row updated if already paid).
- Mark refunded by payment_intent: idempotent (no row updated if already refunded).
- Renewal order insert: idempotent (`ON CONFLICT (stripe_invoice_id) DO NOTHING`).

---

## 5. Subscription Lifecycle Safety

### Can renewals create duplicate orders?

**No.** `createRenewalOrder` uses `INSERT ... ON CONFLICT (stripe_invoice_id) DO NOTHING RETURNING id`; only one order per Stripe invoice ID.

### What happens if invoice.paid fires before checkout.session.completed?

As in §3: subscription may not exist yet; initial order is not marked paid and no renewal is created. When `checkout.session.completed` runs, it does not mark the initial subscription order paid. **Result:** initial subscription order stuck in `pending_payment` (inconsistent state).

### Can subscription ownership be reassigned maliciously?

**No.** `upsertSubscription` is only called from the webhook with `session.metadata.user_id`. Metadata is set server-side at session creation. The `ON CONFLICT` update does not change `user_id`, so ownership is fixed at creation.

### Are subscription IDs unique and bound to a user?

**Yes.** `subscriptions.stripe_subscription_id` is UNIQUE. `user_id` is set from metadata and not updated on conflict.

---

## 6. Refund Abuse

### Can a user trigger refund logic manually?

**No.** Refund is only applied in webhook handlers (`charge.refunded` / `charge.refund.updated`). There is no authenticated API that accepts a refund request from the client.

### Is refund authority server-only?

**Yes.** Refund state changes only via Stripe webhooks (signature-verified). No client endpoint can set status to refunded.

### Are refunds tied strictly to Stripe payment_intent?

**Yes.** `markOrderRefundedByPaymentIntent(paymentIntent, client)` updates only the order with that `stripe_payment_intent_id`. Refund in webhook.routes.js also keys off `charge.payment_intent`.

### Can multiple refunds be processed?

Idempotent: refund UPDATE only affects rows with `status = 'paid'`. After first update, row is `refunded`; subsequent webhooks do not change it again.

---

## 7. Authentication & Authorization

### Are JWTs validated properly?

**No JWTs.** Auth is session-based: cookie `sid` (session UUID), validated in `auth` middleware by DB lookup (`sessions` + `users`) and `expires_at > now()`. So it’s session validation, not JWT.

### Is role-based access enforced server-side?

**No roles.** Only “authenticated” vs “unauthenticated”. All authenticated users are treated the same. No admin vs customer distinction in the code audited.

### Can rate limits be bypassed?

- Limiters are per-IP (express-rate-limit default). Bypass: many IPs (proxies/VPNs) or different `X-Forwarded-For` if not trusted. No server-side verification of forwarded headers is visible.
- `bySessionLimiter` (e.g. for order status) is 30/min; `checkoutLimiter` 20/15 min. No distributed/store-backed rate limit — restart or multiple processes can reset or duplicate counters.

### Are protected routes actually protected?

- **Protected:** `/orders`, `/orders/:id`, `/api/checkout/session`, `/billing/checkout-session`, `/billing/portal`, `/me` use `auth` and return 401 when the session cookie is missing or invalid.
- **Not protected:** `GET /api/orders/by-session/:sessionId` — no auth; anyone with the session ID can poll status.

**Critical authorization bug — Billing portal:**  
`POST /billing/portal` requires auth but accepts `customerId` from the body and does **not** verify that this customer belongs to `req.user`. Any authenticated user can open the Stripe billing portal for **any** Stripe customer ID.

**Exploit:** Attacker obtains victim’s Stripe customer ID (e.g. from a receipt or leak). Attacker logs in as themselves, then `POST /billing/portal` with `{ "customerId": "cus_victim_id" }` and gets a URL to manage the victim’s subscription (cancel, change payment method, etc.).

---

## 8. Database Constraints & Integrity

### Existing constraints (from schema + migrations)

- **orders:** `user_id` FK to `users(id)` ON DELETE CASCADE; `type` CHECK; `status` CHECK; `idempotency_key` UNIQUE; `stripe_checkout_session_id` UNIQUE; `stripe_payment_intent_id` UNIQUE; `stripe_subscription_id` UNIQUE; `stripe_invoice_id` UNIQUE (migration 002).
- **webhook_events:** `stripe_event_id` NOT NULL UNIQUE; `status` CHECK.
- **subscriptions:** `stripe_subscription_id` UNIQUE; `user_id` FK to `users(id)`.

### Missing or weak constraints

| Area | Recommendation |
|------|----------------|
| **orders.amount_cents** | Add `CHECK (amount_cents >= 0)` (and consider upper bound if desired). |
| **orders.currency** | Consider CHECK for allowed list (e.g. `currency IN ('usd')`) or leave flexible. |
| **order_items.unit_amount_cents** | `CHECK (unit_amount_cents >= 0)`; `qty` already effectively positive via application. |
| **order_items.qty** | `CHECK (qty > 0)`. |
| **idempotency_key** | Currently UNIQUE globally. If intent is per-user idempotency, use UNIQUE (user_id, idempotency_key) and handle conflict in app (return existing order for that user). As-is, two users sharing the same key causes one to get 500 on INSERT. |
| **subscriptions.stripe_customer_id** | Consider UNIQUE if one Stripe customer should map to one subscription record (depends on product). |
| **orders** | No constraint that `stripe_invoice_id` is set when `type = 'subscription'` and status is paid (could add for renewal consistency). |

**Gaps identified in your list:**

- `orders.stripe_checkout_session_id` UNIQUE — **present.**
- `orders.stripe_payment_intent_id` UNIQUE — **present.**
- `orders.stripe_invoice_id` UNIQUE — **present** (migration 002).
- `webhook_events.stripe_event_id` UNIQUE — **present.**
- `subscriptions.stripe_subscription_id` UNIQUE — **present.**
- `orders.user_id` FK to `users(id)` — **present.**

So the main gaps are: **amount/qty CHECKs**, and **idempotency_key** semantics (global vs per-user).

---

## 9. Replay & Enumeration

### Can session IDs be brute-forced?

Stripe session IDs are long random strings; brute-force is not realistic. No rate limit on `/api/orders/by-session/:sessionId` beyond `bySessionLimiter` (30/min per IP), so an attacker could try many session IDs slowly; likelihood of hit is still negligible.

### Timing difference between “not found” and “unauthorized”?

For `/api/orders/by-session/:sessionId` there is no auth, so no “unauthorized” response — only 200 (found) vs 404 (not found). So no user-bound timing oracle from this endpoint.

For `/orders/:id`, 404 is “order not found or not yours” (same response either way), so no leak of “exists but belongs to someone else.”

### Can order status polling be abused?

`GET /api/orders/by-session/:sessionId` is rate-limited (30/min). Polling is intended for post-checkout; abuse is limited to consuming rate limit and learning status for session IDs the attacker already has.

---

## 10. Infrastructure Assumptions

### What happens if Redis/rate limiting fails?

No Redis in this codebase. Rate limiting is in-memory (express-rate-limit). If the process restarts, counters reset. Multiple processes each have their own counters, so effective limit is multiplied by process count.

### What happens if DB transaction partially fails?

- **Webhook (stripe-webhook.routes.js):** Entire handler runs in `withTransaction`. On any throw, ROLLBACK — no partial commit of event insert or order/subscription updates. Safe.
- **createOrder:** **Not** in a transaction. Sequence: INSERT order, then multiple INSERT order_items. If the process crashes after the order INSERT but before all item INSERTs, the DB can contain an order with no (or partial) items. **Partial failure can leave inconsistent data.**

### What happens if webhook handler crashes mid-processing?

- With **stripe-webhook.routes.js:** Transaction is rolled back; `webhook_events` row is not committed. Stripe will retry; idempotency check will see no row and reprocess. Safe.
- With **webhooks/stripe:** Event row is inserted before processing. If handler crashes after INSERT but during processing, event is already committed. Retry could see “existing” and return 200 without re-running logic, or (under race) duplicate processing. Inconsistent and unsafe.

---

## Summary by Severity

### CRITICAL (must fix before production)

1. **Billing portal customer ID authorization**  
   **Where:** `backend/src/routes/billing.routes.js` — `POST /billing/portal`.  
   **Issue:** Accepts any `customerId` from the client; does not verify it belongs to `req.user`.  
   **Fix:** Resolve customer from server data (e.g. subscription or order) by `user_id`; create portal session for that customer only. Do not accept `customerId` from the client, or strictly validate it against the current user.

2. **Price manipulation via `/billing/checkout-session`**  
   **Where:** `backend/src/routes/billing.routes.js` — `POST /billing/checkout-session`.  
   **Issue:** Always allows client-supplied `items` with `price` and `quantity`; no production guard.  
   **Fix:** Apply the same production rules as `/api/checkout/session` (e.g. require Stripe price IDs in production and reject client-supplied amounts), or remove this endpoint and use a single checkout API.

3. **Duplicate / weaker webhook handler**  
   **Where:** `POST /webhooks/stripe` (webhook.routes.js).  
   **Issue:** No transaction, race on event insert, no status guard on refund, can leave state inconsistent and allow duplicate processing.  
   **Fix:** Use a single webhook URL (`/api/stripe/webhook`) and remove or fully align `/webhooks/stripe` (same transaction + idempotency + guards as stripe-webhook.routes.js).

4. **Order creation not transactional**  
   **Where:** `backend/src/services/order.service.js` — `createOrder`.  
   **Issue:** Order row and order_items inserted in separate calls; crash can leave order with no items.  
   **Fix:** Run order + order_items inserts in a single DB transaction (e.g. `withTransaction`).

### HIGH severity

5. **No Stripe price ID allowlist**  
   In production, require server-side validation of price IDs (allowlist or Stripe API fetch) so test or arbitrary prices cannot be used.

6. **Out-of-order invoice.paid vs checkout.session.completed**  
   Initial subscription order can remain `pending_payment` if `invoice.paid` arrives first. Harden by: on `checkout.session.completed` (subscription), also mark the corresponding order paid when `session.payment_status === 'paid'`, or on `invoice.paid` re-check for pending order by subscription and mark paid (with idempotent UPDATE).

7. **Idempotency key semantics**  
   Global UNIQUE on `idempotency_key` causes 500 when another user already used the same key. Either enforce UNIQUE (user_id, idempotency_key) and return existing order for that user, or on conflict detect and return the existing order’s session URL when the order belongs to the same user.

### MEDIUM (hardening)

8. **Rate limiting** — Use a shared store (e.g. Redis) for rate limits in multi-instance deployments; consider stricter limits or CAPTCHA for checkout/auth.

9. **Legacy webhook refund UPDATE** — In webhook.routes.js, add `AND status = 'paid'` to the refund UPDATE for consistency with the state machine.

10. **Session cookie in production** — Ensure `SESSION_SECRET` (or equivalent) is set and strong in production; cookie is already httpOnly, secure in prod, sameSite lax.

### Defensive improvements

11. Add CHECK constraints: `orders.amount_cents >= 0`, `order_items.qty > 0`, `order_items.unit_amount_cents >= 0`.
12. Optional: Require auth for `GET /api/orders/by-session/:sessionId` and verify session’s order belongs to `req.user` (or keep unauthenticated but document the leakage and keep rate limit).
13. Log and alert on repeated webhook signature failures and on refund/paid transitions for monitoring.
14. Ensure only one webhook URL is registered in Stripe and that it is the hardened handler.

---

## Final security score: **4 / 10**

- **Critical:** Authorization and price control are broken on at least one endpoint each; duplicate webhook handler and non-atomic order creation risk fraud and inconsistent state.
- **Positive:** Order ownership and listing are correctly scoped to the authenticated user; refunds are server-only and tied to payment_intent; hardened webhook path uses transactions and idempotency; Stripe IDs are uniquely constrained in the DB.

---

## What an attacker would realistically exploit first

1. **Billing portal** — If the victim’s Stripe customer ID is known or guessable (e.g. from a receipt or predictable pattern), open their billing portal and cancel subscription or change payment method.
2. **Price manipulation** — Call `POST /billing/checkout-session` with `items: [{ "name": "X", "price": 0.01, "quantity": 1 }]`, complete Stripe Checkout, and get a paid order for one cent.
3. **Webhook confusion** — If Stripe is pointed at `/webhooks/stripe`, rely on races or retries to cause duplicate or inconsistent order/subscription state.

After fixing the critical items (portal auth, billing checkout price control, single hardened webhook, transactional order creation) and adding price allowlist and subscription ordering robustness, the score could reasonably reach **7–8/10** with the remaining hardening and operational safeguards in place.
