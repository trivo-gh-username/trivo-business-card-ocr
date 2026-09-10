(async function initNav() {
  try {
    const me = await apiGet('/api/me');
    const who = document.getElementById('whoLine');
    if (who) who.textContent = `${me.email} · ${me.role}`;
    const adminLink = document.getElementById('adminLink');
    if (adminLink && me.role === 'admin') {
      adminLink.style.display = '';
      adminLink.href = '/admin.html';
    }
    window.currentUser = me;
  } catch {
    // apiGet already redirects to /login.html on 401
  }
  const logoutLink = document.getElementById('logoutLink');
  if (logoutLink) {
    logoutLink.addEventListener('click', async () => {
      await apiPost('/api/logout', {});
      window.location.href = '/login.html';
    });
  }
})();
