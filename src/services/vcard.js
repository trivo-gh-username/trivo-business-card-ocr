function escapeVcf(str = '') {
  return String(str).replace(/([,;\\])/g, '\\$1').replace(/\n/g, '\\n');
}

function buildVCard(card) {
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${escapeVcf(card.name || 'Unknown')}`,
    card.company ? `ORG:${escapeVcf(card.company)}` : null,
    card.designation ? `TITLE:${escapeVcf(card.designation)}` : null,
    ...(card.phones || []).map((p) => `TEL;TYPE=CELL:${escapeVcf(p)}`),
    ...(card.emails || []).map((e) => `EMAIL:${escapeVcf(e)}`),
    card.website ? `URL:${escapeVcf(card.website)}` : null,
    card.address ? `ADR;TYPE=WORK:;;${escapeVcf(card.address)};;;;` : null,
    card.notes ? `NOTE:${escapeVcf(card.notes)}` : null,
    'END:VCARD',
  ].filter(Boolean);
  return lines.join('\r\n');
}

module.exports = { buildVCard };
