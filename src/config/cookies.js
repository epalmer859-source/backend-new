const { isProd } = require('./env');

const COOKIE_NAME = 'sid';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

module.exports = {
  COOKIE_NAME,
  MAX_AGE_MS,
  cookieOptions: {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax',
    path: '/',
    maxAge: MAX_AGE_MS,
  },
};
