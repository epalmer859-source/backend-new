const { Pool } = require('pg');
const { DATABASE_URL } = require('../config/env');
const logger = require('../utils/logger');

const pool = new Pool({
  connectionString: DATABASE_URL,
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => logger.error({ err }, 'Pool error'));

async function query(text, params) {
  const start = Date.now();
  try {
    const res = await pool.query(text, params);
    logger.debug({ duration: Date.now() - start, rows: res.rowCount }, 'db query');
    return res;
  } catch (err) {
    logger.error({ err, text: text.substring(0, 100) }, 'db query error');
    throw err;
  }
}

/**
 * Run a callback inside a database transaction.
 * On success: COMMIT. On throw: ROLLBACK and rethrow.
 * Use for webhook handlers so all-or-nothing semantics and no double-fulfill under retries.
 */
async function withTransaction(callback) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await callback(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { pool, query, withTransaction };
