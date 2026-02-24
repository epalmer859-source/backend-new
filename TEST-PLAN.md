# ASCEND – Test plan (production backend)

Run these after backend is up and Postgres schema is applied.

---

## 1. Idempotency (checkout)

**Goal:** Spam checkout with same idempotency key → only 1 order + 1 Stripe session.

- Log in as a user.
- Create a checkout session with a fixed `idempotencyKey` (e.g. UUID) and the same cart.
- Call `POST /billing/checkout-session` 10 times with the same `idempotencyKey`.
- **Pass:** Only one new order row and one Stripe Checkout session; subsequent responses return the same `url` (or existing session).
- **Fail:** Multiple orders or multiple sessions for the same key.

---

## 2. Webhook idempotency

**Goal:** Replay same Stripe event → order status changes once.

- Use Stripe CLI: `stripe trigger checkout.session.completed` (or send the same event payload twice with same `event.id`).
- **Pass:** First event is processed (order marked paid); second request with same `event.id` returns 200 and does not change the order again (duplicate ignored via `webhook_events.stripe_event_id` unique).
- **Fail:** Order updated twice or duplicate event causes an error.

---

## 3. Order isolation (user A cannot see user B)

**Goal:** User A must not access User B’s order.

- Create two users (A and B). As B, create an order and note `order_id`.
- As A (different session/cookie), call `GET /orders/{order_id}` where `order_id` is B’s order.
- **Pass:** 404 (or 403). Response must not return B’s order body.
- **Fail:** 200 with B’s order data.

---

## 4. Auth rate limit (brute force)

**Goal:** Many login attempts get 429.

- From one IP, send >10 `POST /auth/login` requests within 15 minutes (wrong or random credentials).
- **Pass:** After the limit (e.g. 10), response is 429 with a rate-limit message.
- **Fail:** No 429; all attempts get 401 without rate limiting.

---

## 5. Success page – payment only after webhook

**Goal:** Success page shows “Processing…” until webhook sets order to paid.

- Start checkout, complete payment in Stripe Test Mode, return to success page with `?checkout=success&order_id=...`.
- **Pass:** Success page calls `GET /orders/:id` and shows “Processing payment…” (or similar) until the webhook has run and `order.status === 'paid'`; then it shows the confirmation. If webhook is delayed, page may poll with a timeout (e.g. 60s).
- **Fail:** Success page shows “Paid” or confirmation before the webhook has updated the order (i.e. frontend must not trust redirect alone).

---

## Quick checklist

| # | Test | Pass |
|---|------|------|
| 1 | Checkout idempotency (same key → 1 order, 1 session) | ☐ |
| 2 | Webhook replay (same event_id → processed once) | ☐ |
| 3 | GET /orders/:id for other user → 404 | ☐ |
| 4 | Auth brute force → 429 | ☐ |
| 5 | Success page waits for webhook for “paid” | ☐ |
