// Run on container startup (see docker-compose.yml command / entrypoint).
// Idempotent: schema.sql uses IF NOT EXISTS everywhere, and the admin seed
// only fires when the users table is empty.

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');
const pool = require('./pool');

async function migrate() {
  const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(schema);
  console.log('[migrate] schema applied');

  const { rows } = await pool.query('SELECT count(*)::int AS n FROM users');
  if (rows[0].n === 0) {
    const email = process.env.SEED_ADMIN_EMAIL;
    const password = process.env.SEED_ADMIN_PASSWORD;
    if (!email || !password) {
      console.warn('[migrate] no users exist yet and SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD are not set — '
        + 'set them in .env and restart, or insert the first admin manually.');
      return;
    }
    const hash = await bcrypt.hash(password, 12);
    await pool.query(
      'INSERT INTO users (email, password_hash, role) VALUES ($1, $2, $3)',
      [email.toLowerCase(), hash, 'admin']
    );
    console.log(`[migrate] seeded initial admin user: ${email}`);
  }
}

if (require.main === module) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => { console.error('[migrate] failed:', err); process.exit(1); });
}

module.exports = migrate;
