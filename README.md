# ASCEND – Run locally

## Structure

- **`app/`** – React (Vite) frontend. Dev server: `npm run dev` (e.g. http://localhost:5173).
- **`app/server/`** – Simple Node/Express server (auth + Stripe Checkout). Port **4242**. No database.
- **`backend/`** – Production Node/Express backend. Port **4000**. Postgres, sessions, webhooks, idempotency.

Use either **app/server** (quick start) or **backend** (production-grade).

---

## Option A: Quick start (app + app/server)

1. **Backend**
   ```bash
   cd app/server
   npm install
   npm start
   ```
   → http://localhost:4242

2. **Frontend**
   ```bash
   cd app
   npm install
   npm run dev
   ```
   → http://localhost:5173

3. Set `VITE_API_URL=http://localhost:4242` in `app/.env` if needed (default is 4242).

---

## Option B: Production backend (backend + app)

1. **Postgres**
   - Create DB, e.g. `createdb ascend`
   - Run schema: `psql $DATABASE_URL -f backend/db/schema.sql`

2. **Backend**
   ```bash
   cd backend
   npm install
   cp .env.example .env
   # Edit .env: DATABASE_URL, SESSION_SECRET, STRIPE_* if needed
   npm start
   ```
   → http://localhost:4000

3. **Stripe webhooks (local)**
   ```bash
   stripe listen --forward-to localhost:4000/webhooks/stripe
   ```
   Put the printed `whsec_...` in `backend/.env` as `STRIPE_WEBHOOK_SECRET`.

4. **Frontend**
   ```bash
   cd app
   npm install
   echo "VITE_API_URL=http://localhost:4000" > .env
   npm run dev
   ```
   → http://localhost:5173

For production backend, the frontend should use cookie auth: `fetch(..., { credentials: 'include' })` and call `GET /me` after login. See `app/src/api/client.ts` and `backend/README.md`.

---

## Vercel deploy (serverless API)

The repo root includes serverless API routes for Vercel:

- **GET /api/health** — returns `{ ok: true, message: "backend alive" }`. Root `/` rewrites here.
- **POST /api/stripe-webhook** — Stripe webhook (verifies signature using raw body).

**After deploy:**

1. **Health:**  
   `https://<VERCEL_PROJECT>.vercel.app/api/health`  
   Expect: `{ ok: true, message: "backend alive" }`

2. **Stripe webhook URL:**  
   `https://<VERCEL_PROJECT>.vercel.app/api/stripe-webhook`

**Env vars (set in Vercel project settings):**

- `STRIPE_SECRET_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `DATABASE_URL` (if used)
- `FRONTEND_URL` (if used)

Vercel uses the `/api/*.js` functions only; no `app.listen()` is used.

---

## Test plan

See **TEST-PLAN.md** for required tests (idempotency, webhook replay, order isolation, rate limit, success page).
