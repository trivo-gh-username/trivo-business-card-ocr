const pool = require('../db/pool');
const { encrypt, decrypt } = require('./crypto');

const KEYS = {
  GEMINI_API_KEY: 'gemini_api_key_enc',
  GEMINI_MODEL: 'gemini_model',
};

async function get(key) {
  const { rows } = await pool.query('SELECT value FROM settings WHERE key = $1', [key]);
  return rows[0] ? rows[0].value : null;
}

async function set(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [key, value]
  );
}

async function getGeminiApiKey() {
  const enc = await get(KEYS.GEMINI_API_KEY);
  return enc ? decrypt(enc) : (process.env.GEMINI_API_KEY || null); // env var as a fallback default
}

async function setGeminiApiKey(plainKey) {
  await set(KEYS.GEMINI_API_KEY, encrypt(plainKey));
}

async function getGeminiModel() {
  return (await get(KEYS.GEMINI_MODEL)) || process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite';
}

async function setGeminiModel(model) {
  await set(KEYS.GEMINI_MODEL, model);
}

async function hasGeminiKeyConfigured() {
  return !!(await getGeminiApiKey());
}

module.exports = {
  getGeminiApiKey, setGeminiApiKey,
  getGeminiModel, setGeminiModel,
  hasGeminiKeyConfigured,
};
