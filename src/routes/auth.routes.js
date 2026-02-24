const { z } = require('zod');
const express = require('express');
const authService = require('../services/auth.service');
const { auth } = require('../middleware/auth');
const validate = require('../middleware/validate');
const { authLimiter } = require('../middleware/rateLimit');
const { COOKIE_NAME } = require('../config/cookies');

const router = express.Router();

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  confirmPassword: z.string(),
  name: z.string().optional(),
}).refine((d) => d.password === d.confirmPassword, { message: 'Passwords do not match', path: ['confirmPassword'] });

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/register', authLimiter, validate(registerSchema), async (req, res, next) => {
  try {
    const { email, password, confirmPassword: _cp, name } = req.body;
    const result = await authService.register(email, password, name);
    if (result.error) {
      return res.status(409).json({ error: result.error });
    }
    res.status(201).json({ user: result.user });
  } catch (err) {
    next(err);
  }
});

router.post('/login', authLimiter, validate(loginSchema), async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password, res);
    if (result.error) {
      return res.status(401).json({ error: result.error });
    }
    res.json({ user: result.user });
  } catch (err) {
    next(err);
  }
});

router.post('/logout', auth, async (req, res, next) => {
  try {
    await authService.logout(req.sessionId, res);
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});

router.get('/me', auth, async (req, res, next) => {
  try {
    const user = await authService.getMe(req.user.id);
    if (!user) return res.status(404).json({ error: 'User not found' });
    res.json({ user: { id: user.id, email: user.email, name: user.name } });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
