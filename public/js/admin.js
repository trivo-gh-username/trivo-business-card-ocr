async function loadSettings() {
  const s = await apiGet('/api/admin/settings');
  document.getElementById('keyStatus').textContent = s.geminiKeyConfigured
    ? 'A key is configured. Paste a new one below to replace it.'
    : 'No key configured yet — card reading will fall back to on-device OCR only until you add one.';

  const modelSelect = document.getElementById('modelSelect');
  if (s.geminiKeyConfigured) {
    try {
      const models = await apiGet('/api/admin/gemini-models');
      modelSelect.innerHTML = models.map((m) =>
        `<option value="${m.id}" ${m.id === s.geminiModel ? 'selected' : ''}>${m.displayName} (${m.id})</option>`
      ).join('') || '<option value="">No models returned</option>';
      if (!models.some((m) => m.id === s.geminiModel)) {
        modelSelect.insertAdjacentHTML('afterbegin', `<option value="${s.geminiModel}" selected>${s.geminiModel} (current, not in live list)</option>`);
      }
    } catch (err) {
      modelSelect.innerHTML = `<option value="${s.geminiModel}">${s.geminiModel} (could not fetch live list: ${err.message})</option>`;
    }
  } else {
    modelSelect.innerHTML = `<option value="${s.geminiModel}">${s.geminiModel} (add an API key to see live options)</option>`;
  }
}

document.getElementById('saveKeyBtn').addEventListener('click', async () => {
  const apiKey = document.getElementById('apiKeyInput').value.trim();
  if (!apiKey) return;
  const note = document.getElementById('keySavedNote');
  try {
    await apiPut('/api/admin/settings/gemini-key', { apiKey });
    document.getElementById('apiKeyInput').value = '';
    note.textContent = 'Saved.';
    loadSettings();
  } catch (err) {
    note.textContent = err.message;
    note.style.color = 'var(--bad)';
  }
  setTimeout(() => { note.textContent = ''; note.style.color = ''; }, 3000);
});

document.getElementById('saveModelBtn').addEventListener('click', async () => {
  const model = document.getElementById('modelSelect').value;
  await apiPut('/api/admin/settings/gemini-model', { model });
  const note = document.getElementById('modelSavedNote');
  note.textContent = 'Saved.';
  setTimeout(() => { note.textContent = ''; }, 2500);
});

async function loadUsers() {
  const users = await apiGet('/api/users');
  document.querySelector('#usersTable tbody').innerHTML = users.map((u) => `
    <tr>
      <td>${u.email}</td>
      <td><span class="role-badge ${u.role}">${u.role}</span></td>
      <td>${u.is_active ? 'active' : 'disabled'}</td>
      <td>
        <select data-role-for="${u.id}">
          ${['admin', 'editor', 'viewer'].map((r) => `<option value="${r}" ${r === u.role ? 'selected' : ''}>${r}</option>`).join('')}
        </select>
        <button type="button" class="btn-sm btn btn-ghost" data-toggle-active="${u.id}" data-active="${u.is_active}">${u.is_active ? 'Disable' : 'Enable'}</button>
      </td>
    </tr>`).join('');

  document.querySelectorAll('[data-role-for]').forEach((sel) => {
    sel.addEventListener('change', async () => {
      await apiPatch(`/api/users/${sel.dataset.roleFor}`, { role: sel.value });
      loadUsers();
    });
  });
  document.querySelectorAll('[data-toggle-active]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await apiPatch(`/api/users/${btn.dataset.toggleActive}`, { is_active: btn.dataset.active !== 'true' });
      loadUsers();
    });
  });
}

document.getElementById('addUserBtn').addEventListener('click', async () => {
  const email = document.getElementById('newUserEmail').value.trim();
  const password = document.getElementById('newUserPassword').value;
  const role = document.getElementById('newUserRole').value;
  const note = document.getElementById('userSavedNote');
  try {
    await apiPost('/api/users', { email, password, role });
    document.getElementById('newUserEmail').value = '';
    document.getElementById('newUserPassword').value = '';
    note.textContent = 'User added.';
    loadUsers();
  } catch (err) {
    note.textContent = err.message;
    note.style.color = 'var(--bad)';
  }
  setTimeout(() => { note.textContent = ''; note.style.color = ''; }, 3000);
});

async function loadAuditLog() {
  const entries = await apiGet('/api/admin/audit-log');
  document.querySelector('#auditTable tbody').innerHTML = entries.map((e) => `
    <tr>
      <td>${new Date(e.created_at).toLocaleString()}</td>
      <td>${e.actor_email || 'system'}</td>
      <td>${e.action}</td>
    </tr>`).join('');
}

loadSettings();
loadUsers();
loadAuditLog();
