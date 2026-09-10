const pool = require('../db/pool');

/** Returns existing, non-deleted cards that share any phone or email with the given values. */
async function findPossibleDuplicates({ phones = [], emails = [] }, excludeId = null) {
  if (!phones.length && !emails.length) return [];
  const { rows } = await pool.query(
    `SELECT id, name, company, phones, emails
     FROM cards
     WHERE deleted_at IS NULL
       AND ($3::uuid IS NULL OR id <> $3)
       AND (phones && $1::text[] OR emails && $2::text[])
     LIMIT 5`,
    [phones, emails, excludeId]
  );
  return rows;
}

module.exports = { findPossibleDuplicates };
