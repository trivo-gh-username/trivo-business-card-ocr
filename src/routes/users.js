const express = require('express');
const bcrypt = require('bcryptjs');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../auth/middleware');
const { logAction } = require('../services/audit');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

router.get('/api/users', async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, email, role, is_active, created_at FROM users ORDER BY created_at ASC'
  );
  res.json(rows);
});

router.post('/api/users', async (req, res) => {
  const { email, password, role } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'Email and password are required.' });
  if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  if (!['admin', 'editor', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role.' });

  const hash = await bcrypt.hash(password, 12);
  try {
    const { rows } = await pool.query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3) RETURNING id, email, role, is_active, created_at',
      [email.toLowerCase().trim(), hash, role]
    );
    await logAction(req, 'user.create', rows[0].id, { email, role });
    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: 'A user with that email already exists.' });
    throw err;
  }
});

router.patch('/api/users/:id', async (req, res) => {
  const { role, is_active, password } = req.body || {};
  const updates = [];
  const values = [];
  let i = 1;

  if (role) {
    if (!['admin', 'editor', 'viewer'].includes(role)) return res.status(400).json({ error: 'Invalid role.' });
    updates.push(`role = $${i++}`); values.push(role);
  }
  if (typeof is_active === 'boolean') {
    updates.push(`is_active = $${i++}`); values.push(is_active);
  }
  if (password) {
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    updates.push(`password_hash = $${i++}`); values.push(await bcrypt.hash(password, 12));
  }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });

  values.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE users SET ${updates.join(', ')} WHERE id = $${i} RETURNING id, email, role, is_active, created_at`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: 'User not found.' });
  await logAction(req, 'user.update', req.params.id, req.body);
  res.json(rows[0]);
});

module.exports = router;
