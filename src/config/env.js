require('dotenv').config();

module.exports = {
  NODE_ENV: process.env.NODE_ENV || 'development',
  PORT: Number(process.env.PORT) || 4000,
  FRONTEND_ORIGIN: process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  FRONTEND_URL: process.env.FRONTEND_URL || process.env.FRONTEND_ORIGIN || 'http://localhost:5173',
  SESSION_SECRET: process.env.SESSION_SECRET || 'dev-secret-change-in-production',
  STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY || null,
  STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET || null,
  DATABASE_URL: process.env.DATABASE_URL || 'postgres://localhost:5432/ascend',
  isProd: process.env.NODE_ENV === 'production',
};
