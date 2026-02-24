const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const corsConfig = require('./config/cors');
const requestId = require('./middleware/requestId');
const errorHandler = require('./middleware/errorHandler');
const { generalLimiter, bySessionLimiter } = require('./middleware/rateLimit');
const pinoHttp = require('pino-http');
const logger = require('./utils/logger');

const authRoutes = require('./routes/auth.routes');
const orderRoutes = require('./routes/order.routes');
const billingRoutes = require('./routes/billing.routes');
const webhookRoutes = require('./routes/webhook.routes');
const checkoutRoutes = require('./routes/checkout.routes');
const stripeWebhookRoutes = require('./routes/stripe-webhook.routes');
const orderService = require('./services/order.service');
const { auth } = require('./middleware/auth');
const authService = require('./services/auth.service');

const app = express();

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://js.stripe.com'],
      frameSrc: ['https://js.stripe.com'],
      connectSrc: ["'self'", 'https://api.stripe.com', 'https://js.stripe.com'],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  crossOriginResourcePolicy: { policy: 'cross-origin' },
}));

app.use(cors(corsConfig));
app.use(cookieParser());
app.use(requestId);
app.use(pinoHttp({ logger, genReqId: (req) => req.id }));

app.use(generalLimiter);

app.get('/health', (req, res) => {
  res.json({ ok: true, message: 'Backend is running' });
});

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'Backend is running' });
});

app.use('/webhooks', webhookRoutes);

// Stripe webhook must be mounted before express.json() so it receives raw body for signature verification.
app.use('/api/stripe', stripeWebhookRoutes);

app.use(express.json({ limit: '100kb' }));

// Stripe Checkout session IDs: cs_test_... or cs_live_... (reject invalid format without hitting DB).
const STRIPE_SESSION_ID_REGEX = /^cs_(test|live)_[A-Za-z0-9]+$/;

app.get('/api/orders/by-session/:sessionId', bySessionLimiter, async (req, res, next) => {
  try {
    const { sessionId } = req.params;
    if (!STRIPE_SESSION_ID_REGEX.test(sessionId)) {
      return res.status(400).json({ error: 'Invalid session ID format' });
    }
    const order = await orderService.getOrderByStripeSessionId(sessionId);
    if (!order) return res.status(404).json({ error: 'Not found' });
    res.json({ status: order.status });
  } catch (err) {
    next(err);
  }
});

app.use('/api/checkout', checkoutRoutes);

app.use('/auth', authRoutes);

app.get('/me', auth, async (req, res, next) => {
  try {
    const user = await authService.getMe(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    next(err);
  }
});

app.use('/orders', orderRoutes);
app.use('/api/orders', orderRoutes);
app.use('/billing', billingRoutes);

app.use((req, res) => {
  res.status(404).json({ error: 'Not found' });
});

app.use(errorHandler);

module.exports = app;
