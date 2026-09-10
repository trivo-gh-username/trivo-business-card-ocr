const express = require('express');
const { nanoid } = require('nanoid');
const pool = require('../db/pool');
const { requireAuth, requireRole } = require('../auth/middleware');
const images = require('../services/images');
const gemini = require('../services/gemini');
const ocr = require('../services/ocr');
const dedupe = require('../services/dedupe');
const { buildVCard } = require('../services/vcard');
const { logAction } = require('../services/audit');

const router = express.Router();
router.use(requireAuth);

const SORTABLE = { name: 'name', company: 'company', created_at: 'created_at', updated_at: 'updated_at' };

// ---- parse: Gemini primary, Tesseract fallback ----

router.post('/api/cards/parse', requireRole('admin', 'editor'), async (req, res) => {
  const { front, back } = req.body || {};
  if (!front) return res.status(400).json({ error: 'front image (base64) is required' });

  try {
    const fields = await gemini.parseCardImages({ frontBase64: front, backBase64: back });
    return res.json({ fields, engineUsed: 'gemini' });
  } catch (geminiErr) {
    console.warn('[parse] Gemini failed, falling back to local OCR:', geminiErr.message);
    try {
      const frontBuffer = Buffer.from(front, 'base64');
      const backBuffer = back ? Buffer.from(back, 'base64') : null;
      const { fields } = await ocr.ocrFallback({ frontBuffer, backBuffer });
      return res.json({ fields, engineUsed: 'tesseract', geminiError: geminiErr.message });
    } catch (ocrErr) {
      return res.status(502).json({ error: `Both readers failed. Gemini: ${geminiErr.message}. OCR: ${ocrErr.message}` });
    }
  }
});

// ---- create ----

router.post('/api/cards', requireRole('admin', 'editor'), async (req, res) => {
  const b = req.body || {};
  const phones = Array.isArray(b.phones) ? b.phones.filter(Boolean) : [];
  const emails = Array.isArray(b.emails) ? b.emails.filter(Boolean) : [];

  if (!b.force) {
    const dupes = await dedupe.findPossibleDuplicates({ phones, emails });
    if (dupes.length) return res.status(409).json({ duplicates: dupes });
  }

  let frontImage = null, backImage = null;
  if (b.frontImage) frontImage = (await images.compressAndSave(b.frontImage)).filename;
  if (b.backImage) backImage = (await images.compressAndSave(b.backImage)).filename;

  const { rows } = await pool.query(
    `INSERT INTO cards (created_by, name, designation, company, phones, emails, website, address, notes, engine_used, front_image, back_image)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [req.session.userId, b.name || '', b.designation || '', b.company || '', phones, emails,
      b.website || '', b.address || '', b.notes || '', b.engineUsed || 'manual', frontImage, backImage]
  );
  await logAction(req, 'card.create', rows[0].id, {});
  res.status(201).json(rows[0]);
});

// ---- list (search + filter + sort + pagination) ----

router.get('/api/cards', async (req, res) => {
  const { q, engine, dateFrom, dateTo, sort = 'created_at', dir = 'desc', deleted } = req.query;
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize || '20', 10)));

  const showDeleted = deleted === '1' && ['admin', 'editor'].includes(req.session.role);
  const where = [showDeleted ? 'deleted_at IS NOT NULL' : 'deleted_at IS NULL'];
  const values = [];
  let i = 1;

  if (q) {
    where.push(`(name ILIKE $${i} OR company ILIKE $${i} OR designation ILIKE $${i}
                 OR array_to_string(phones, ' ') ILIKE $${i} OR array_to_string(emails, ' ') ILIKE $${i})`);
    values.push(`%${q}%`); i++;
  }
  if (engine) { where.push(`engine_used = $${i++}`); values.push(engine); }
  if (dateFrom) { where.push(`created_at >= $${i++}`); values.push(dateFrom); }
  if (dateTo) { where.push(`created_at <= $${i++}`); values.push(dateTo); }

  const sortCol = SORTABLE[sort] || 'created_at';
  const sortDir = dir === 'asc' ? 'ASC' : 'DESC';

  const countRes = await pool.query(`SELECT count(*)::int AS n FROM cards WHERE ${where.join(' AND ')}`, values);
  const dataRes = await pool.query(
    `SELECT * FROM cards WHERE ${where.join(' AND ')} ORDER BY ${sortCol} ${sortDir} LIMIT $${i} OFFSET $${i + 1}`,
    [...values, pageSize, (page - 1) * pageSize]
  );

  res.json({ cards: dataRes.rows, total: countRes.rows[0].n, page, pageSize });
});

// ---- export (respects the same filters as list, no pagination) ----

router.get('/api/cards/export', async (req, res) => {
  const { q, engine, format = 'json' } = req.query;
  const where = ['deleted_at IS NULL'];
  const values = [];
  let i = 1;
  if (q) { where.push(`(name ILIKE $${i} OR company ILIKE $${i})`); values.push(`%${q}%`); i++; }
  if (engine) { where.push(`engine_used = $${i++}`); values.push(engine); }

  const { rows } = await pool.query(
    `SELECT name, designation, company, phones, emails, website, address, notes, engine_used, created_at
     FROM cards WHERE ${where.join(' AND ')} ORDER BY created_at DESC`,
    values
  );

  if (format === 'csv') {
    const header = ['name', 'designation', 'company', 'phones', 'emails', 'website', 'address', 'notes', 'engine_used', 'created_at'];
    const escape = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = [header.join(',')];
    for (const r of rows) {
      lines.push(header.map((h) => escape(Array.isArray(r[h]) ? r[h].join('; ') : r[h])).join(','));
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="cardbox-export.csv"');
    return res.send(lines.join('\n'));
  }

  res.setHeader('Content-Disposition', 'attachment; filename="cardbox-export.json"');
  res.json(rows);
});

// ---- single card ----

router.get('/api/cards/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM cards WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Card not found.' });
  res.json(rows[0]);
});

router.patch('/api/cards/:id', requireRole('admin', 'editor'), async (req, res) => {
  const b = req.body || {};
  const fields = ['name', 'designation', 'company', 'website', 'address', 'notes'];
  const updates = [];
  const values = [];
  let i = 1;
  for (const f of fields) {
    if (b[f] !== undefined) { updates.push(`${f} = $${i++}`); values.push(b[f]); }
  }
  if (b.phones !== undefined) { updates.push(`phones = $${i++}`); values.push(b.phones); }
  if (b.emails !== undefined) { updates.push(`emails = $${i++}`); values.push(b.emails); }
  if (!updates.length) return res.status(400).json({ error: 'Nothing to update.' });
  updates.push('updated_at = now()');

  values.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE cards SET ${updates.join(', ')} WHERE id = $${i} AND deleted_at IS NULL RETURNING *`,
    values
  );
  if (!rows[0]) return res.status(404).json({ error: 'Card not found.' });
  await logAction(req, 'card.update', req.params.id, {});
  res.json(rows[0]);
});

router.delete('/api/cards/:id', requireRole('admin', 'editor'), async (req, res) => {
  const { rows } = await pool.query(
    'UPDATE cards SET deleted_at = now() WHERE id = $1 AND deleted_at IS NULL RETURNING id', [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Card not found.' });
  await logAction(req, 'card.delete', req.params.id, {});
  res.json({ ok: true });
});

router.post('/api/cards/:id/restore', requireRole('admin', 'editor'), async (req, res) => {
  const { rows } = await pool.query(
    'UPDATE cards SET deleted_at = NULL WHERE id = $1 RETURNING *', [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: 'Card not found.' });
  await logAction(req, 'card.restore', req.params.id, {});
  res.json(rows[0]);
});

// ---- digital card: vCard + public share toggle ----

router.get('/api/cards/:id/vcard', async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM cards WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Card not found.' });
  res.setHeader('Content-Type', 'text/vcard');
  res.setHeader('Content-Disposition', `attachment; filename="${(rows[0].name || 'card').replace(/[^\w-]/g, '_')}.vcf"`);
  res.send(buildVCard(rows[0]));
});

router.put('/api/cards/:id/share', requireRole('admin', 'editor'), async (req, res) => {
  const { enabled } = req.body || {};
  const { rows: existing } = await pool.query('SELECT share_slug FROM cards WHERE id = $1', [req.params.id]);
  if (!existing[0]) return res.status(404).json({ error: 'Card not found.' });

  const slug = existing[0].share_slug || nanoid(10);
  const { rows } = await pool.query(
    'UPDATE cards SET share_enabled = $1, share_slug = $2 WHERE id = $3 RETURNING share_enabled, share_slug',
    [!!enabled, slug, req.params.id]
  );
  await logAction(req, 'card.share', req.params.id, { enabled: !!enabled });
  res.json(rows[0]);
});

// ---- comments ----

router.get('/api/cards/:id/comments', async (req, res) => {
  const { rows } = await pool.query(
    `SELECT c.id, c.body, c.created_at, u.email AS author_email
     FROM comments c LEFT JOIN users u ON u.id = c.author_id
     WHERE card_id = $1 ORDER BY created_at ASC`,
    [req.params.id]
  );
  res.json(rows);
});

router.post('/api/cards/:id/comments', requireRole('admin', 'editor'), async (req, res) => {
  const { body } = req.body || {};
  if (!body || !body.trim()) return res.status(400).json({ error: 'Comment cannot be empty.' });
  const { rows } = await pool.query(
    `INSERT INTO comments (card_id, author_id, body) VALUES ($1, $2, $3)
     RETURNING id, body, created_at`,
    [req.params.id, req.session.userId, body.trim()]
  );
  res.status(201).json({ ...rows[0], author_email: req.session.email });
});

router.delete('/api/comments/:id', async (req, res) => {
  const { rows } = await pool.query('SELECT author_id FROM comments WHERE id = $1', [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: 'Comment not found.' });
  if (rows[0].author_id !== req.session.userId && req.session.role !== 'admin') {
    return res.status(403).json({ error: 'You can only delete your own comments.' });
  }
  await pool.query('DELETE FROM comments WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
});

// ---- authenticated image serving ----

router.get('/api/images/:filename', async (req, res) => {
  const buffer = await images.readImage(req.params.filename);
  if (!buffer) return res.status(404).end();
  res.setHeader('Content-Type', 'image/jpeg');
  res.setHeader('Cache-Control', 'private, max-age=86400');
  res.send(buffer);
});

module.exports = router;
