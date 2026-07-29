'use strict';

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatDate(iso) {
  return iso ? new Date(iso).toLocaleString('de-AT') : 'Unbefristet';
}

async function loadUser() {
  const res = await apiFetch('/api/me');
  if (!res.ok) { window.location.href = '/'; return; }
  const user = await res.json();
  document.getElementById('userInfo').innerHTML = `
    <img src="${user.avatar}" class="user-avatar" alt="${escapeHtml(user.username)}" />
    <span class="fw-semibold">${escapeHtml(user.username)}</span>
  `;
}

async function loadStatus() {
  const card = document.getElementById('statusCard');
  try {
    const res  = await apiFetch('/api/license/status');
    const data = await res.json();

    if (!res.ok) {
      card.innerHTML = `<div class="text-danger small">${escapeHtml(data.error || 'Fehler beim Laden.')}</div>`;
      return;
    }
    if (!data.activated) {
      card.innerHTML = `<div class="text-muted"><i class="bi bi-exclamation-triangle-fill text-warning me-2"></i>Für diesen Server ist noch keine Lizenz aktiviert.</div>`;
      return;
    }

    card.innerHTML = `
      <div class="d-flex align-items-center justify-content-between mb-2">
        <span class="fw-semibold">${escapeHtml(data.label || 'Lizenz')}</span>
        <span class="ticket-badge ${data.valid ? 'badge-open' : 'badge-closed'}">${data.valid ? '✅ Gültig' : `❌ ${escapeHtml(data.status)}`}</span>
      </div>
      <div class="text-muted small"><i class="bi bi-calendar-event me-1"></i>Läuft ab: ${formatDate(data.expiresAt)}</div>
    `;
  } catch {
    card.innerHTML = '<div class="text-danger small">Netzwerkfehler.</div>';
  }
}

async function activateLicense() {
  const key = document.getElementById('activateKey').value.trim();
  const alertEl = document.getElementById('activateAlert');
  if (!key) { alertEl.className = 'alert alert-danger'; alertEl.textContent = 'Bitte einen Lizenzschlüssel eingeben.'; return; }

  const btn = document.getElementById('activateBtn');
  btn.disabled = true;
  try {
    const res  = await apiFetch('/api/license/activate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ key }),
    });
    const data = await res.json();
    if (res.ok) {
      alertEl.className = 'alert alert-success';
      alertEl.textContent = '✓ Lizenz aktiviert!';
      await loadStatus();
    } else {
      alertEl.className = 'alert alert-danger';
      alertEl.textContent = data.error || 'Fehler bei der Aktivierung.';
    }
  } catch {
    alertEl.className = 'alert alert-danger';
    alertEl.textContent = 'Netzwerkfehler.';
  } finally {
    btn.disabled = false;
  }
}

loadUser();
loadStatus();
