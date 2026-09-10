const pool = require('../db/pool');

async function logAction(req, action, target, meta) {
  try {
    await pool.query(
      'INSERT INTO audit_log (actor_id, action, target, meta) VALUES ($1, $2, $3, $4)',
      [req.session?.userId || null, action, target ? String(target) : null, meta ? JSON.stringify(meta) : null]
    );
  } catch (err) {
    console.error('[audit] failed to log action:', action, err.message);
  }
}

module.exports = { logAction };
