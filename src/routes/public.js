const express = require('express');
const QRCode = require('qrcode');
const pool = require('../db/pool');
const images = require('../services/images');
const { buildVCard } = require('../services/vcard');

const router = express.Router();

async function getSharedCard(slug) {
  const { rows } = await pool.query(
    'SELECT * FROM cards WHERE share_slug = $1 AND share_enabled = true AND deleted_at IS NULL',
    [slug]
  );
  return rows[0] || null;
}

router.get('/api/public/cards/:slug', async (req, res) => {
  const card = await getSharedCard(req.params.slug);
  if (!card) return res.status(404).json({ error: 'This card is not available.' });
  const { id, created_by, ...safe } = card; // eslint-disable-line no-unused-vars
  res.json(safe);
});

router.get('/api/public/cards/:slug/vcard', async (req, res) => {
  const card = await getSharedCard(req.params.slug);
  if (!card) return res.status(404).json({ error: 'This card is not available.' });
  res.setHeader('Content-Type', 'text/vcard');
  res.setHeader('Content-Disposition', `attachment; filename="${(card.name || 'card').replace(/[^\w-]/g, '_')}.vcf"`);
  res.send(buildVCard(card));
});

router.get('/api/public/cards/:slug/qr', async (req, res) => {
  const card = await getSharedCard(req.params.slug);
  if (!card) return res.status(404).end();
  const url = `${req.protocol}://${req.get('host')}/c/${req.params.slug}`;
  const png = await QRCode.toBuffer(url, { width: 240, margin: 1 });
  res.setHeader('Content-Type', 'image/png');
  res.send(png);
});

// Public image access -- only serves images that belong to a currently-shared card.
router.get('/api/public/images/:filename', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT 1 FROM cards WHERE share_enabled = true AND deleted_at IS NULL
     AND (front_image = $1 OR back_image = $1) LIMIT 1`,
    [req.params.filename]
  );
  if (!rows[0]) return res.status(404).end();
  const buffer = await images.readImage(req.params.filename);
  if (!buffer) return res.status(404).end();
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'public, max-age=86400');
  res.send(buffer);
});

module.exports = router;
