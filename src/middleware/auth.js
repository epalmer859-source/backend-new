const { query } = require('../db');
const { COOKIE_NAME, cookieOptions } = require('../config/cookies');
const logger = require('../utils/logger');

async function auth(req, res, next) {
  const sid = req.cookies?.[COOKIE_NAME];
  if (!sid) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  try {
    const r = await query(
      `SELECT s.id, s.user_id, u.email, u.name
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = $1 AND s.expires_at > now()`,
      [sid]
    );
    if (r.rows.length === 0) {
      res.clearCookie(COOKIE_NAME, cookieOptions);
      return res.status(401).json({ error: 'Session expired' });
    }
    const row = r.rows[0];
    req.user = { id: row.user_id, email: row.email, name: row.name };
    req.sessionId = row.id;
    next();
  } catch (err) {
    logger.error({ err }, 'auth middleware');
    res.status(500).json({ error: 'Internal server error' });
  }
}

function optionalAuth(req, res, next) {
  const sid = req.cookies?.[COOKIE_NAME];
  if (!sid) return next();
  query(
    `SELECT s.user_id, u.email, u.name FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = $1 AND s.expires_at > now()`,
    [sid]
  )
    .then((r) => {
      if (r.rows.length > 0) {
        const row = r.rows[0];
        req.user = { id: row.user_id, email: row.email, name: row.name };
      }
      next();
    })
    .catch((err) => {
      logger.error({ err }, 'optionalAuth');
      next();
    });
}

module.exports = { auth, optionalAuth };
