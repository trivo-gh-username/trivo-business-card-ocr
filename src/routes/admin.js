const express = require('express');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../auth/middleware');
const settings = require('../services/settings');
const gemini = require('../services/gemini');
const { logAction } = require('../services/audit');

const router = express.Router();
router.use(requireAuth, requireRole('admin'));

router.get('/api/admin/settings', async (req, res) => {
  res.json({
    geminiKeyConfigured: await settings.hasGeminiKeyConfigured(),
    geminiModel: await settings.getGeminiModel(),
  });
});

router.put('/api/admin/settings/gemini-key', async (req, res) => {
  const { apiKey } = req.body || {};
  if (!apiKey || apiKey.length < 10) return res.status(400).json({ error: 'That does not look like a valid API key.' });
  await settings.setGeminiApiKey(apiKey.trim());
  await logAction(req, 'settings.gemini_key.update', null, {});
  res.json({ ok: true });
});

router.put('/api/admin/settings/gemini-model', async (req, res) => {
  const { model } = req.body || {};
  if (!model) return res.status(400).json({ error: 'Model is required.' });
  await settings.setGeminiModel(model);
  await logAction(req, 'settings.gemini_model.update', null, { model });
  res.json({ ok: true });
});

router.get('/api/admin/gemini-models', async (req, res) => {
  try {
    const models = await gemini.listAvailableModels();
    res.json(models);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

router.get('/api/admin/audit-log', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT a.id, a.action, a.target, a.meta, a.created_at, u.email AS actor_email
     FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
     ORDER BY a.created_at DESC LIMIT 200`
  );
  res.json(rows);
});

module.exports = router;
