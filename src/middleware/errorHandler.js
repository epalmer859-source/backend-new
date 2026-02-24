const logger = require('../utils/logger');
const { isProd } = require('../config/env');

function errorHandler(err, req, res, next) {
  const status = err.statusCode || err.status || 500;
  const message = err.message || 'Internal server error';
  const reqId = req.id || '';

  logger.error({ err, reqId, path: req.path, userId: req.user?.id }, message);

  if (res.headersSent) return next(err);

  res.status(status).json({
    error: isProd && status === 500 ? 'Internal server error' : message,
    ...(reqId && { requestId: reqId }),
  });
}

module.exports = errorHandler;
