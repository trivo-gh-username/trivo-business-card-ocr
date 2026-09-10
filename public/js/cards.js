const state = { q: '', engine: '', sort: 'created_at', dir: 'desc', page: 1, pageSize: 20, trash: false };
let activeCard = null;

const gallery = document.getElementById('gallery');
const countLine = document.getElementById('countLine');
const pagination = document.getElementById('pagination');
const searchInput = document.getElementById('searchInput');
const sheetOverlay = document.getElementById('sheetOverlay');

const ENGINE_LABEL = { gemini: 'Gemini', tesseract: 'On-device OCR', manual: 'Manual entry' };

// Prefill search from ?q= if arriving from the scan page's duplicate banner.
const initialQ = new URLSearchParams(window.location.search).get('q');
if (initialQ) { state.q = initialQ; searchInput.value = initialQ; }

function fmtDate(iso) {
  try { return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); }
  catch { return ''; }
}

function buildQuery(extra = {}) {
  const params = new URLSearchParams({
    q: state.q, engine: state.engine, sort: state.sort, dir: state.dir,
    page: state.page, pageSize: state.pageSize,
    ...(state.trash ? { deleted: '1' } : {}),
    ...extra,
  });
  for (const [k, v] of [...params]) if (!v) params.delete(k);
  return params.toString();
}

async function load() {
  const data = await apiGet(`/api/cards?${buildQuery()}`);
  renderGallery(data.cards);
  countLine.textContent = `${data.total} card${data.total === 1 ? '' : 's'}`;
  renderPagination(data.total);
}

function renderGallery(cards) {
  if (!cards.length) {
    gallery.innerHTML = `<div class="card" style="text-align:center;color:var(--graphite);">${state.trash ? 'Nothing in the trash.' : 'No cards match.'}</div>`;
    return;
  }
  gallery.innerHTML = cards.map(itemHtml).join('');
  cards.forEach((c) => document.getElementById('g-' + c.id).addEventListener('click', () => openSheet(c.id)));
}

function itemHtml(c) {
  const thumb = c.front_image ? `/api/images/${c.front_image}` : (c.back_image ? `/api/images/${c.back_image}` : '');
  const meta = [c.designation, c.company].filter(Boolean).join(' · ');
  return `
    <div class="gallery-item" id="g-${c.id}">
      ${thumb ? `<img class="thumb" src="${thumb}" alt="" />` : '<div class="thumb"></div>'}
      <div class="info"><div class="name">${c.name || 'Untitled card'}</div><div class="meta">${meta || '—'}</div></div>
      <span class="engine-pill ${c.engine_used}">${ENGINE_LABEL[c.engine_used] || c.engine_used}</span>
    </div>`;
}

function renderPagination(total) {
  const pages = Math.max(1, Math.ceil(total / state.pageSize));
  pagination.innerHTML = `
    <button class="btn-sm btn btn-ghost" id="prevPage" ${state.page <= 1 ? 'disabled' : ''}>Prev</button>
    <span>Page ${state.page} of ${pages}</span>
    <button class="btn-sm btn btn-ghost" id="nextPage" ${state.page >= pages ? 'disabled' : ''}>Next</button>`;
  document.getElementById('prevPage').addEventListener('click', () => { state.page--; load(); });
  document.getElementById('nextPage').addEventListener('click', () => { state.page++; load(); });
}

let searchDebounce;
searchInput.addEventListener('input', () => {
  clearTimeout(searchDebounce);
  searchDebounce = setTimeout(() => { state.q = searchInput.value.trim(); state.page = 1; load(); }, 300);
});
document.getElementById('engineFilter').addEventListener('change', (e) => { state.engine = e.target.value; state.page = 1; load(); });
document.getElementById('sortSelect').addEventListener('change', (e) => { state.sort = e.target.value; state.page = 1; load(); });
document.querySelectorAll('.chip[data-filter]').forEach((chip) => {
  chip.addEventListener('click', () => {
    document.querySelectorAll('.chip[data-filter]').forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    state.trash = chip.dataset.filter === 'trash';
    state.page = 1; load();
  });
});
document.getElementById('exportCsv').addEventListener('click', (e) => { e.preventDefault(); window.location.href = `/api/cards/export?format=csv&${buildQuery()}`; });
document.getElementById('exportJson').addEventListener('click', (e) => { e.preventDefault(); window.location.href = `/api/cards/export?format=json&${buildQuery()}`; });

// Only admin/editor ever need the trash view.
(function initTrashChipVisibility() {
  const check = () => {
    if (window.currentUser && ['admin', 'editor'].includes(window.currentUser.role)) {
      document.getElementById('trashChip').style.display = '';
    }
  };
  setTimeout(check, 300); // nav.js sets window.currentUser asynchronously
})();

// ---- detail sheet ----

async function openSheet(id) {
  activeCard = await apiGet(`/api/cards/${id}`);
  renderViewMode();
  showViewMode();
  sheetOverlay.classList.add('open');
  loadComments();
}
function closeSheet() { sheetOverlay.classList.remove('open'); activeCard = null; }
sheetOverlay.addEventListener('click', (e) => { if (e.target === sheetOverlay) closeSheet(); });

function canEdit() { return window.currentUser && ['admin', 'editor'].includes(window.currentUser.role); }
function isAdmin() { return window.currentUser && window.currentUser.role === 'admin'; }

function renderViewMode() {
  const c = activeCard;
  document.getElementById('cardPhotos').innerHTML = [c.front_image, c.back_image].filter(Boolean)
    .map((f) => `<img src="/api/images/${f}" alt="" />`).join('') || '';
  document.getElementById('viewName').textContent = c.name || 'Untitled card';
  document.getElementById('viewSub').textContent = [c.designation, c.company].filter(Boolean).join(' · ') || 'No designation or company recorded';

  document.getElementById('sheetTags').innerHTML = `
    <span class="engine-pill ${c.engine_used}">${ENGINE_LABEL[c.engine_used] || c.engine_used}</span>
    <span class="date-tag">Scanned ${fmtDate(c.created_at)}</span>
    ${c.deleted_at ? '<span class="date-tag" style="color:var(--bad);">In trash</span>' : ''}`;

  const rows = [
    ['Phones', (c.phones || []).join(', ')],
    ['Emails', (c.emails || []).join(', ')],
    ['Website', c.website],
    ['Address', c.address],
    ['Notes', c.notes],
  ].filter(([, v]) => v);
  document.getElementById('detailGrid').innerHTML = rows.length
    ? rows.map(([l, v]) => `<div class="detail-row"><span class="detail-label">${l}</span><span class="detail-value">${v}</span></div>`).join('')
    : '<p class="lede">No further details recorded.</p>';

  const actions = [];
  actions.push(`<a href="/api/cards/${c.id}/vcard" class="btn btn-ghost">Download vCard</a>`);
  if (canEdit() && !c.deleted_at) actions.push('<button type="button" class="btn btn-ghost" id="editBtn">Edit details</button>');
  if (canEdit() && !c.deleted_at) actions.push('<button type="button" class="btn btn-danger-ghost" id="deleteBtn">Move to trash</button>');
  if (canEdit() && c.deleted_at) actions.push('<button type="button" class="btn btn-brass" id="restoreBtn">Restore</button>');
  document.getElementById('sheetActions').innerHTML = actions.join('');
  document.getElementById('editBtn')?.addEventListener('click', openEditMode);
  document.getElementById('deleteBtn')?.addEventListener('click', deleteCard);
  document.getElementById('restoreBtn')?.addEventListener('click', restoreCard);

  renderShareBox();
}

function renderShareBox() {
  const c = activeCard;
  const box = document.getElementById('shareBox');
  if (!canEdit()) { box.innerHTML = ''; return; }
  if (c.share_enabled && c.share_slug) {
    const url = `${window.location.origin}/c/${c.share_slug}`;
    box.innerHTML = `
      <div class="card" style="background:var(--paper-dim);">
        <strong>Digital card is public</strong>
        <p class="lede" style="margin:6px 0 10px;"><a href="${url}" target="_blank">${url}</a></p>
        <button type="button" class="btn btn-ghost btn-sm" id="unshareBtn">Turn off sharing</button>
      </div>`;
    document.getElementById('unshareBtn').addEventListener('click', () => setShare(false));
  } else {
    box.innerHTML = `<button type="button" class="btn btn-ghost" id="shareBtn">Make digital card public</button>`;
    document.getElementById('shareBtn').addEventListener('click', () => setShare(true));
  }
}

async function setShare(enabled) {
  const result = await apiPut(`/api/cards/${activeCard.id}/share`, { enabled });
  activeCard.share_enabled = result.share_enabled;
  activeCard.share_slug = result.share_slug;
  renderShareBox();
}

function showViewMode() {
  document.getElementById('viewMode').style.display = 'block';
  document.getElementById('editMode').style.display = 'none';
}

function openEditMode() {
  const c = activeCard;
  document.getElementById('eName').value = c.name || '';
  document.getElementById('eDesignation').value = c.designation || '';
  document.getElementById('eCompany').value = c.company || '';
  document.getElementById('eWebsite').value = c.website || '';
  document.getElementById('eAddress').value = c.address || '';
  document.getElementById('eNotes').value = c.notes || '';
  renderEditableRows('ePhoneRows', c.phones, 'Phone number');
  renderEditableRows('eEmailRows', c.emails, 'Email address');
  document.getElementById('viewMode').style.display = 'none';
  document.getElementById('editMode').style.display = 'block';
}
document.getElementById('cancelEditBtn').addEventListener('click', showViewMode);

function renderEditableRows(containerId, values, placeholder) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  const list = values && values.length ? values : [''];
  list.forEach((v) => addEditableRow(container, v, placeholder));
}
function addEditableRow(container, value, placeholder) {
  const row = document.createElement('div');
  row.className = 'repeatable-row';
  row.innerHTML = `<input type="text" value="${value ? String(value).replace(/"/g, '&quot;') : ''}" placeholder="${placeholder}" /><button type="button">&times;</button>`;
  row.querySelector('button').addEventListener('click', () => { if (container.children.length > 1) row.remove(); else row.querySelector('input').value = ''; });
  container.appendChild(row);
}
document.querySelectorAll('#editMode .add-row-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.add === 'ePhones' ? 'ePhoneRows' : 'eEmailRows';
    const placeholder = btn.dataset.add === 'ePhones' ? 'Phone number' : 'Email address';
    addEditableRow(document.getElementById(target), '', placeholder);
  });
});
function collectEditableRows(containerId) {
  return Array.from(document.querySelectorAll(`#${containerId} input`)).map((i) => i.value.trim()).filter(Boolean);
}

document.getElementById('editMode').addEventListener('submit', async (e) => {
  e.preventDefault();
  const updated = await apiPatch(`/api/cards/${activeCard.id}`, {
    name: document.getElementById('eName').value.trim(),
    designation: document.getElementById('eDesignation').value.trim(),
    company: document.getElementById('eCompany').value.trim(),
    website: document.getElementById('eWebsite').value.trim(),
    address: document.getElementById('eAddress').value.trim(),
    notes: document.getElementById('eNotes').value.trim(),
    phones: collectEditableRows('ePhoneRows'),
    emails: collectEditableRows('eEmailRows'),
  });
  activeCard = updated;
  renderViewMode();
  showViewMode();
  load();
});

async function deleteCard() {
  if (!confirm('Move this card to the trash? An admin or editor can restore it later.')) return;
  await apiDelete(`/api/cards/${activeCard.id}`);
  closeSheet();
  load();
}
async function restoreCard() {
  activeCard = await apiPost(`/api/cards/${activeCard.id}/restore`, {});
  renderViewMode();
  load();
}

// ---- comments ----

async function loadComments() {
  const comments = await apiGet(`/api/cards/${activeCard.id}/comments`);
  document.getElementById('commentsList').innerHTML = comments.length
    ? comments.map(commentHtml).join('')
    : '<p class="lede" style="margin:0;">No comments yet.</p>';
  comments.forEach((cm) => {
    document.getElementById('del-' + cm.id)?.addEventListener('click', async () => {
      await apiDelete(`/api/comments/${cm.id}`);
      loadComments();
    });
  });
  document.getElementById('commentForm').style.display = canEdit() ? 'flex' : 'none';
}
function commentHtml(cm) {
  const canDelete = isAdmin() || (window.currentUser && cm.author_email === window.currentUser.email);
  return `<div class="comment-item">
    ${canDelete ? `<span class="del" id="del-${cm.id}">Delete</span>` : ''}
    <div class="meta">${cm.author_email || 'Unknown'} · ${fmtDate(cm.created_at)}</div>
    <div class="body">${cm.body}</div>
  </div>`;
}
document.getElementById('commentForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const input = document.getElementById('commentInput');
  if (!input.value.trim()) return;
  await apiPost(`/api/cards/${activeCard.id}/comments`, { body: input.value.trim() });
  input.value = '';
  loadComments();
});

load();
