const argon2 = require('argon2');
const { v4: uuidv4 } = require('uuid');
const { query } = require('../db');
const { COOKIE_NAME, MAX_AGE_MS, cookieOptions } = require('../config/cookies');
const logger = require('../utils/logger');

async function register(email, password, name) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const hash = await argon2.hash(password, { type: argon2.argon2id });
  const displayName = (name && String(name).trim()) || normalizedEmail.split('@')[0] || 'Customer';
  try {
    const r = await query(
      `INSERT INTO users (email, password_hash, name) VALUES ($1, $2, $3)
       RETURNING id, email, name`,
      [normalizedEmail, hash, displayName]
    );
    return { user: r.rows[0] };
  } catch (err) {
    if (err.code === '23505') {
      return { error: 'You already have an account with this email. Please sign in instead.' };
    }
    logger.error({ err }, 'auth.service register');
    throw err;
  }
}

async function login(email, password, res) {
  const normalizedEmail = String(email).trim().toLowerCase();
  const r = await query(
    `SELECT id, email, name, password_hash FROM users WHERE email = $1 LIMIT 1`,
    [normalizedEmail]
  );
  if (r.rows.length === 0) {
    return { error: "You don't have an account with this email yet. Please sign up first." };
  }
  const user = r.rows[0];
  const ok = await argon2.verify(user.password_hash, password);
  if (!ok) {
    return { error: 'Incorrect password.' };
  }
  const sessionId = uuidv4();
  const expiresAt = new Date(Date.now() + MAX_AGE_MS);
  await query(
    `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, $3)`,
    [sessionId, user.id, expiresAt]
  );
  res.cookie(COOKIE_NAME, sessionId, { ...cookieOptions, maxAge: MAX_AGE_MS });
  return {
    user: { id: user.id, email: user.email, name: user.name },
  };
}

async function logout(sessionId, res) {
  if (sessionId) {
    await query(`DELETE FROM sessions WHERE id = $1`, [sessionId]);
  }
  res.clearCookie(COOKIE_NAME, cookieOptions);
}

async function getMe(userId) {
  const r = await query(
    `SELECT id, email, name, created_at FROM users WHERE id = $1 LIMIT 1`,
    [userId]
  );
  return r.rows[0] || null;
}

module.exports = { register, login, logout, getMe };
