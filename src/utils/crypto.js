const crypto = require('crypto');

function randomId() {
  return crypto.randomBytes(16).toString('hex');
}

function secureToken() {
  return crypto.randomBytes(32).toString('hex');
}

module.exports = { randomId, secureToken };
