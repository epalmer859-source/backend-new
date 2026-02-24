const pino = require('pino');
const { NODE_ENV } = require('../config/env');

module.exports = pino({
  level: NODE_ENV === 'production' ? 'info' : 'debug',
  ...(NODE_ENV !== 'production' && {
    transport: { target: 'pino/file', options: { destination: 1 } },
  }),
});
