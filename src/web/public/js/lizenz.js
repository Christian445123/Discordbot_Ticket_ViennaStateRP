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

  if (user.isSuperAdmin) {
    document.getElementById('adminSection').classList.remove('d-none');
    loadAdminLicenses();
  }
}

// ── Bot-Admin: cross-guild license management ────────────────────────────────
function statusBadge(status) {
  return status === 'active'
    ? '<span class="ticket-badge badge-open">✅ Aktiv</span>'
    : '<span class="ticket-badge badge-closed">🔒 Gesperrt</span>';
}

async function loadAdminLicenses() {
  const tbody = document.getElementById('licensesTableBody');
  try {
    const res = await apiFetch('/api/license/admin/licenses');
    if (!res.ok) { tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">Fehler beim Laden.</td></tr>`; return; }
    const licenses = await res.json();

    if (!licenses.length) { tbody.innerHTML = `<tr><td colspan="6" class="text-center text-muted py-4">Noch keine Lizenzen vorhanden.</td></tr>`; return; }

    tbody.innerHTML = licenses.map(l => `
      <tr>
        <td class="fw-mono small">${escapeHtml(l.license_key)}</td>
        <td>${escapeHtml(l.label || '–')}</td>
        <td>${statusBadge(l.status)}</td>
        <td>${l.active_guilds}/${l.max_guilds}</td>
        <td class="text-muted small">${formatDate(l.expires_at)}</td>
        <td class="text-end">
          <button class="btn btn-sm btn-outline-secondary" onclick="extendLicense('${l.license_key}')" title="Um Tage verlängern">
            <i class="bi bi-calendar-plus"></i>
          </button>
          ${l.status === 'active'
            ? `<button class="btn btn-sm btn-outline-danger" onclick="toggleLicenseStatus('${l.license_key}', 'revoked')" title="Sperren"><i class="bi bi-lock-fill"></i></button>`
            : `<button class="btn btn-sm btn-outline-success" onclick="toggleLicenseStatus('${l.license_key}', 'active')" title="Entsperren"><i class="bi bi-unlock-fill"></i></button>`}
        </td>
      </tr>
    `).join('');
  } catch {
    tbody.innerHTML = `<tr><td colspan="6" class="text-center text-danger py-4">Netzwerkfehler.</td></tr>`;
  }
}

async function createLicense() {
  const label     = document.getElementById('createLabel').value.trim();
  const maxGuilds = document.getElementById('createMaxGuilds').value;
  const days      = document.getElementById('createDays').value;
  const alertEl   = document.getElementById('createAlert');

  try {
    const res  = await apiFetch('/api/license/admin/licenses', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ label, maxGuilds, days }),
    });
    const data = await res.json();
    if (res.ok) {
      alertEl.className = 'alert alert-success';
      alertEl.innerHTML = `✓ Lizenz erstellt: <code>${escapeHtml(data.licenseKey)}</code>`;
      document.getElementById('createLabel').value = '';
      document.getElementById('createDays').value  = '';
      await loadAdminLicenses();
    } else {
      alertEl.className = 'alert alert-danger';
      alertEl.textContent = data.error || 'Fehler beim Erstellen.';
    }
  } catch {
    alertEl.className = 'alert alert-danger';
    alertEl.textContent = 'Netzwerkfehler.';
  }
}

async function toggleLicenseStatus(key, status) {
  await apiFetch(`/api/license/admin/licenses/${encodeURIComponent(key)}/status`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }),
  });
  loadAdminLicenses();
}

async function extendLicense(key) {
  const days = prompt('Um wie viele Tage verlängern?', '30');
  if (!days) return;
  await apiFetch(`/api/license/admin/licenses/${encodeURIComponent(key)}/extend`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days }),
  });
  loadAdminLicenses();
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
