const express = require('express');

const router = express.Router();

// Deprecated. Use POST /api/stripe/webhook only. Stripe must be configured to that URL.
router.post('/stripe', express.raw({ type: 'application/json' }), (req, res) => {
  res.status(410).json({ error: 'Deprecated webhook endpoint' });
});

module.exports = router;
