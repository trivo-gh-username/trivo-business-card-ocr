const crypto = require('crypto');

function getMasterKey() {
  const secret = process.env.SECRETS_MASTER_KEY;
  if (!secret) throw new Error('SECRETS_MASTER_KEY is not set — required to store the Gemini API key.');
  // Accept any length input, derive a fixed 32-byte key from it.
  return crypto.createHash('sha256').update(secret).digest();
}

function encrypt(plaintext) {
  const key = getMasterKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  // store as iv:tag:ciphertext, each base64
  return [iv, tag, ciphertext].map((b) => b.toString('base64')).join(':');
}

function decrypt(stored) {
  if (!stored) return null;
  const key = getMasterKey();
  const [ivB64, tagB64, dataB64] = stored.split(':');
  const iv = Buffer.from(ivB64, 'base64');
  const tag = Buffer.from(tagB64, 'base64');
  const data = Buffer.from(dataB64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
