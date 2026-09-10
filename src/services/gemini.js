const settings = require('./settings');

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING' },
    designation: { type: 'STRING' },
    company: { type: 'STRING' },
    phones: { type: 'ARRAY', items: { type: 'STRING' } },
    emails: { type: 'ARRAY', items: { type: 'STRING' } },
    website: { type: 'STRING' },
    address: { type: 'STRING' },
  },
  required: ['name', 'designation', 'company', 'phones', 'emails', 'website', 'address'],
};

const PROMPT = `You are reading one physical visiting/business card from one or two photos (front, and possibly back).
Extract the contact details as JSON matching the given schema.
Rules:
- Cards vary a lot: some list one phone number, others list three (cell, WhatsApp, landline) -- capture ALL of them in the phones array, don't drop any and don't invent any.
- Capture every email address present.
- "designation" is the person's job title/role line, not the organisation name. "company" is the institute/university/company name.
- If the back of the card lists extra address details, courses, or extra phone numbers, merge that into the same record -- this is still one card.
- If a field truly isn't present, return "" or [], not a guess.
- Keep titles like "Dr." as part of "name", as printed.`;

class GeminiError extends Error {
  constructor(message, status) {
    super(message);
    this.status = status || 502;
  }
}

async function parseCardImages({ frontBase64, backBase64 }) {
  const apiKey = await settings.getGeminiApiKey();
  if (!apiKey) throw new GeminiError('No Gemini API key configured. Ask an admin to add one.', 412);
  const model = await settings.getGeminiModel();

  const parts = [{ text: PROMPT }, { inline_data: { mime_type: 'image/jpeg', data: frontBase64 } }];
  if (backBase64) parts.push({ inline_data: { mime_type: 'image/jpeg', data: backBase64 } });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  let res;
  try {
    res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA, temperature: 0.1 },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if (err.name === 'AbortError') throw new GeminiError('Gemini timed out after 20s', 504);
    throw new GeminiError(`Could not reach Gemini: ${err.message}`, 502);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GeminiError(`Gemini error (${res.status}): ${text.slice(0, 300)}`, res.status === 429 ? 429 : 502);
  }

  const data = await res.json();
  const candidate = data?.candidates?.[0];
  const text = candidate?.content?.parts?.[0]?.text;
  if (!text) throw new GeminiError(`Gemini returned no content (finishReason: ${candidate?.finishReason || 'unknown'})`, 502);

  try {
    return JSON.parse(text);
  } catch {
    throw new GeminiError('Gemini did not return valid JSON', 502);
  }
}

/** Live model list for the admin dropdown -- filtered to models that can read images. */
async function listAvailableModels() {
  const apiKey = await settings.getGeminiApiKey();
  if (!apiKey) throw new GeminiError('No Gemini API key configured yet.', 412);

  const res = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', {
    headers: { 'x-goog-api-key': apiKey },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new GeminiError(`Could not list models (${res.status}): ${text.slice(0, 300)}`, 502);
  }
  const data = await res.json();
  const models = (data.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .filter((m) => /flash|pro/i.test(m.name)) // skip embedding/tts/image-gen/etc. model families
    .map((m) => ({
      id: m.name.replace(/^models\//, ''),
      displayName: m.displayName || m.name,
      description: m.description || '',
    }));
  return models;
}

module.exports = { parseCardImages, listAvailableModels, GeminiError };
