const draft = { frontImage: null, backImage: null, lastFields: null, lastEngine: null };

const frontSlot = document.getElementById('frontSlot');
const backSlot = document.getElementById('backSlot');
const scanBtn = document.getElementById('scanBtn');
const statusBanner = document.getElementById('statusBanner');
const dupBanner = document.getElementById('dupBanner');
const reviewForm = document.getElementById('reviewForm');

function setBanner(kind, text, retry) {
  if (!kind) { statusBanner.innerHTML = ''; return; }
  const spinner = kind === 'parsing' ? '<span class="spinner"></span>' : '';
  const retryBtn = retry ? '<button type="button" class="banner-retry-btn" id="bannerRetryBtn">Retry</button>' : '';
  statusBanner.innerHTML = `<div class="status-banner ${kind}">${spinner}<span>${text}</span>${retryBtn}</div>`;
  if (retry) document.getElementById('bannerRetryBtn').addEventListener('click', retry);
}

function wireSlotInput(inputEl, slotEl, which) {
  inputEl.addEventListener('change', (e) => handleCapture(e, slotEl, which));
}
wireSlotInput(document.getElementById('frontInput'), frontSlot, 'Front');
wireSlotInput(document.getElementById('backInput'), backSlot, 'Back');
wireSlotInput(document.getElementById('frontUploadInput'), frontSlot, 'Front');
wireSlotInput(document.getElementById('backUploadInput'), backSlot, 'Back');

function fillSlot(slotEl, dataUrl, labelText) {
  slotEl.classList.add('filled');
  slotEl.innerHTML = `<img src="${dataUrl}" alt="${labelText}" /><span class="retake">Retake</span><input type="file" accept="image/*" capture="environment" />`;
  slotEl.querySelector('input').addEventListener('change', (e) => handleCapture(e, slotEl, labelText));
}

async function handleCapture(e, slotEl, which) {
  const file = e.target.files[0];
  if (!file) return;
  const dataUrl = await fileToCompressedBase64(file);
  if (which === 'Front') draft.frontImage = dataUrl; else draft.backImage = dataUrl;
  fillSlot(slotEl, dataUrl, which);
  scanBtn.disabled = !draft.frontImage;
}

function resetCapture() {
  draft.frontImage = null; draft.backImage = null; draft.lastFields = null; draft.lastEngine = null;
  frontSlot.className = 'capture-slot';
  frontSlot.innerHTML = `<span class="label">Front</span><span class="hint">Tap to capture</span><input type="file" accept="image/*" capture="environment" id="frontInput" />`;
  backSlot.className = 'capture-slot';
  backSlot.innerHTML = `<span class="label">Back (optional)</span><span class="hint">Tap to capture</span><input type="file" accept="image/*" capture="environment" id="backInput" />`;
  wireSlotInput(document.getElementById('frontInput'), frontSlot, 'Front');
  wireSlotInput(document.getElementById('backInput'), backSlot, 'Back');
  scanBtn.disabled = true;
  dupBanner.innerHTML = '';
  reviewForm.style.display = 'none';
  reviewForm.reset();
}

function renderRepeatable(containerId, values, placeholder) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  const list = values && values.length ? values : [''];
  list.forEach((v) => addRepeatableRow(container, v, placeholder));
}
function addRepeatableRow(container, value, placeholder) {
  const row = document.createElement('div');
  row.className = 'repeatable-row';
  row.innerHTML = `<input type="text" value="${value ? String(value).replace(/"/g, '&quot;') : ''}" placeholder="${placeholder}" /><button type="button">&times;</button>`;
  row.querySelector('button').addEventListener('click', () => {
    if (container.children.length > 1) row.remove(); else row.querySelector('input').value = '';
  });
  container.appendChild(row);
}
document.querySelectorAll('.add-row-btn[data-add]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.add === 'phones' ? 'phoneRows' : 'emailRows';
    const placeholder = btn.dataset.add === 'phones' ? 'Phone number' : 'Email address';
    addRepeatableRow(document.getElementById(target), '', placeholder);
  });
});
function collectRepeatable(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} input`)).map((i) => i.value.trim()).filter(Boolean);
}

function populateForm(fields) {
  document.getElementById('fName').value = fields.name || '';
  document.getElementById('fDesignation').value = fields.designation || '';
  document.getElementById('fCompany').value = fields.company || '';
  document.getElementById('fWebsite').value = fields.website || '';
  document.getElementById('fAddress').value = fields.address || '';
  document.getElementById('fNotes').value = '';
  renderRepeatable('phoneRows', fields.phones || [], 'Phone number');
  renderRepeatable('emailRows', fields.emails || [], 'Email address');
}

const ENGINE_LABEL = { gemini: 'Gemini', tesseract: 'on-device OCR (fallback)', manual: 'manual entry' };

scanBtn.addEventListener('click', async () => {
  scanBtn.disabled = true;
  setBanner('parsing', 'Reading the card…');
  try {
    const { fields, engineUsed } = await apiPost('/api/cards/parse', {
      front: base64Payload(draft.frontImage),
      back: base64Payload(draft.backImage),
    });
    draft.lastFields = fields;
    draft.lastEngine = engineUsed;
    populateForm(fields);
    setBanner('ok', `Read using ${ENGINE_LABEL[engineUsed] || engineUsed} — check the fields below.`);
  } catch (err) {
    populateForm({});
    draft.lastEngine = 'manual';
    setBanner('error', `${err.message} — fill the fields in by hand below, or`, () => scanBtn.click());
  }
  document.getElementById('reviewLede').textContent = 'Fix anything the reader got wrong, then save.';
  reviewForm.style.display = 'block';
  reviewForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
});

document.getElementById('cancelBtn').addEventListener('click', resetCapture);

async function saveCard(force) {
  const payload = {
    name: document.getElementById('fName').value.trim(),
    designation: document.getElementById('fDesignation').value.trim(),
    company: document.getElementById('fCompany').value.trim(),
    website: document.getElementById('fWebsite').value.trim(),
    address: document.getElementById('fAddress').value.trim(),
    notes: document.getElementById('fNotes').value.trim(),
    phones: collectRepeatable('phoneRows'),
    emails: collectRepeatable('emailRows'),
    engineUsed: draft.lastEngine || 'manual',
    frontImage: base64Payload(draft.frontImage),
    backImage: base64Payload(draft.backImage),
    force: !!force,
  };
  try {
    await apiPost('/api/cards', payload);
    dupBanner.innerHTML = '';
    setBanner('ok', 'Saved to the shared database.');
    resetCapture();
  } catch (err) {
    if (err.status === 409 && err.data && err.data.duplicates) {
      renderDuplicates(err.data.duplicates);
    } else {
      setBanner('error', err.message);
    }
  }
}

function renderDuplicates(dupes) {
  const items = dupes.map((d) => `<div class="dup-item">• <strong>${d.name || 'Untitled'}</strong>${d.company ? ' · ' + d.company : ''} — already in the database</div>`).join('');
  dupBanner.innerHTML = `
    <div class="dup-banner">
      <strong>Possible duplicate</strong>
      ${items}
      <div class="dup-actions">
        <button type="button" class="btn btn-ghost btn-sm" id="viewExistingBtn">View existing</button>
        <button type="button" class="btn btn-brass btn-sm" id="saveAnywayBtn">Save anyway</button>
      </div>
    </div>`;
  document.getElementById('saveAnywayBtn').addEventListener('click', () => saveCard(true));
  document.getElementById('viewExistingBtn').addEventListener('click', () => { window.location.href = `/cards.html?q=${encodeURIComponent(dupes[0].name || '')}`; });
  dupBanner.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

reviewForm.addEventListener('submit', (e) => { e.preventDefault(); saveCard(false); });
