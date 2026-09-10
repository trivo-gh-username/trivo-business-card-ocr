const express = require('express');
const bcrypt = require('bcryptjs');
const rateLimit = require('express-rate-limit');
const pool = require('../db/pool');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10, // 10 attempts per IP per 15 minutes
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Try again in a few minutes.' },
});

router.post('/api/login', loginLimiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });

  const { rows } = await pool.query(
    'SELECT id, email, password_hash, role, is_active FROM users WHERE email = $1',
    [String(email).toLowerCase().trim()]
  );
  const user = rows[0];
  // Constant-shape response whether the user exists or not, to avoid leaking which emails are registered.
  const ok = user && user.is_active && await bcrypt.compare(password, user.password_hash);
  if (!ok) return res.status(401).json({ error: 'Incorrect email or password.' });

  req.session.userId = user.id;
  req.session.email = user.email;
  req.session.role = user.role;
  res.json({ id: user.id, email: user.email, role: user.role });
});

router.post('/api/logout', (req, res) => {
  req.session.destroy(() => res.json({ ok: true }));
});

router.get('/api/me', (req, res) => {
  if (!req.session || !req.session.userId) return res.status(401).json({ error: 'Not logged in' });
  res.json({ id: req.session.userId, email: req.session.email, role: req.session.role });
});

module.exports = router;
