const express = require('express');
const { auth } = require('../middleware/auth');
const orderService = require('../services/order.service');

const router = express.Router();

router.use(auth);

router.get('/', async (req, res, next) => {
  try {
    const orders = await orderService.getOrdersByUser(req.user.id);
    res.json({ orders });
  } catch (err) {
    next(err);
  }
});

router.get('/:id', async (req, res, next) => {
  try {
    const order = await orderService.getOrderById(req.user.id, req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json({ order });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
