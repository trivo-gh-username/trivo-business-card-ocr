const { execFile } = require('child_process');
const { promisify } = require('util');
const fs = require('fs/promises');
const os = require('os');
const path = require('path');

const execFileAsync = promisify(execFile);

const DESIGNATION_KEYWORDS = [
  'director', 'officer', 'president', 'manager', 'head of', 'professor',
  'dean', 'principal', 'chairman', 'ceo', 'coordinator', 'vice president',
  'trainer', 'placement', 'faculty', 'associate', 'assistant', 'lecturer',
];
const COMPANY_KEYWORDS = [
  'institute', 'university', 'college', 'technologies', 'technology',
  'solutions', 'pvt', 'ltd', 'llp', 'inc', 'trust', 'school', 'academy',
  'corp', 'company', 'enterprises', 'systems', 'group', 'foundation',
];

async function runTesseract(imageBuffer) {
  const tmpPath = path.join(os.tmpdir(), `cardbox-ocr-${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`);
  await fs.writeFile(tmpPath, imageBuffer);
  try {
    // `tesseract <image> stdout` prints recognised text to stdout.
    // --oem 1 = LSTM only (faster, and the "best" trained data is LSTM-only anyway).
    const { stdout } = await execFileAsync('tesseract', [tmpPath, 'stdout', '--oem', '1', '-l', 'eng'], {
      timeout: 20000,
      maxBuffer: 10 * 1024 * 1024,
    });
    return stdout;
  } finally {
    fs.unlink(tmpPath).catch(() => {});
  }
}

function extractEmails(text) {
  const matches = text.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
  return [...new Set(matches.map((m) => m.toLowerCase()))];
}

function extractPhones(text) {
  const candidates = text.match(/[\d][\d\s-]{7,}\d/g) || [];
  const seen = new Set();
  const phones = [];
  for (const raw of candidates) {
    const digits = raw.replace(/\D/g, '');
    if (digits.length >= 10 && digits.length <= 13 && !seen.has(digits)) {
      seen.add(digits);
      phones.push(raw.trim().replace(/\s{2,}/g, ' '));
    }
  }
  return phones;
}

function extractWebsite(text, emails) {
  const emailDomains = new Set(emails.map((e) => e.split('@')[1]));
  const matches = text.match(/\b(?:https?:\/\/)?(?:www\.)?[a-zA-Z0-9-]+\.(?:[a-zA-Z]{2,3}\.)?[a-zA-Z]{2,}\b/g) || [];
  const candidate = matches.find((m) => {
    const bare = m.replace(/^https?:\/\//, '').replace(/^www\./, '');
    return !emailDomains.has(bare) && /\.(com|in|org|net|co|edu|io)/i.test(m) && !/@/.test(m);
  });
  return candidate || '';
}

function parseTextHeuristics(rawText) {
  const emails = extractEmails(rawText);
  const phones = extractPhones(rawText);
  const website = extractWebsite(rawText, emails);

  const lines = rawText.split('\n').map((l) => l.trim()).filter(Boolean)
    .filter((l) => !emails.some((e) => l.toLowerCase().includes(e)))
    .filter((l) => !phones.some((p) => l.includes(p.replace(/\s/g, ''))))
    .filter((l) => l.length > 1);

  let name = '';
  const designationLines = [];
  const companyLines = [];
  const addressLines = [];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (DESIGNATION_KEYWORDS.some((k) => lower.includes(k))) designationLines.push(line);
    else if (COMPANY_KEYWORDS.some((k) => lower.includes(k))) companyLines.push(line);
    else if (!name && /^[A-Za-z.\s]+$/.test(line) && line.split(' ').length <= 5 && line.length <= 40) name = line;
    else addressLines.push(line);
  }

  return {
    name, designation: designationLines.join(' / '), company: companyLines.join(' / '),
    phones, emails, website, address: addressLines.join(', '),
  };
}

/** Fallback used only when Gemini is unavailable/unconfigured/erroring. */
async function ocrFallback({ frontBuffer, backBuffer }) {
  const texts = [await runTesseract(frontBuffer)];
  if (backBuffer) texts.push(await runTesseract(backBuffer));
  const rawText = texts.join('\n');
  return { fields: parseTextHeuristics(rawText), rawText };
}

module.exports = { ocrFallback };
