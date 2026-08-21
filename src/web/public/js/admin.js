'use strict';

let currentUser  = null;
let activeTab    = 'categories'; // 'categories' | 'tickets' | 'license'

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatDate(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('de-AT', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

// ── Load user & gate access ─────────────────────────────────────────────────
async function loadUser() {
  const res = await apiFetch('/api/me');
  if (!res.ok) { window.location.href = '/'; return; }
  currentUser = await res.json();

  document.getElementById('userInfo').innerHTML = `
    <img src="${currentUser.avatar}" class="user-avatar" alt="${escapeHtml(currentUser.username)}" />
    <span class="fw-semibold">${escapeHtml(currentUser.username)}</span>
  `;

  if (!currentUser.isAdmin && !currentUser.isSuperAdmin) {
    document.getElementById('accessDenied').classList.remove('d-none');
    return false;
  }
  document.getElementById('adminContent').classList.remove('d-none');
  if (currentUser.isSuperAdmin) document.getElementById('licenseAdminSection').classList.remove('d-none');
  return true;
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(tab) {
  activeTab = tab;
  ['categories', 'tickets', 'license'].forEach(t => {
    document.getElementById(`pane-${t}`)?.classList.toggle('d-none', t !== tab);
    document.getElementById(`tab-${t}`)?.classList.toggle('active', t === tab);
  });
  if (tab === 'categories') loadCategorySettings();
  if (tab === 'tickets')    { loadStats(); loadTickets(); }
  if (tab === 'license')    loadLicenseStatus();
}

// ── Categories & automatic messages ─────────────────────────────────────────
let adminCategories = [];
let guildRoles = [];

async function loadCategorySettings() {
  const container = document.getElementById('categoryCards');
  container.innerHTML = '<p class="text-muted small">Lade Kategorien…</p>';
  try {
    const [catRes] = await Promise.all([apiFetch('/api/admin/categories'), loadGuildRoles()]);
    if (!catRes.ok) { container.innerHTML = '<p class="text-danger small">Fehler beim Laden.</p>'; return; }
    adminCategories = await catRes.json();
    renderCategoryCards();
  } catch {
    container.innerHTML = '<p class="text-danger small">Netzwerkfehler.</p>';
  }
}

async function loadGuildRoles() {
  try {
    const res = await apiFetch('/api/admin/guild-roles');
    guildRoles = res.ok ? await res.json() : [];
  } catch { guildRoles = []; }

  const select = document.getElementById('catEditPingRole');
  const options = guildRoles.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
  select.innerHTML = `<option value="">Keine</option>${options}`;
}

// Auslastung: jede Kategorie im Verhältnis zu allen aktuell offenen Tickets
// des Servers — 0-25% grün, 26-50% gelb, 51-75% rot, 76-100% violett.
function loadBadge(openCount, totalOpen) {
  if (!totalOpen) return `<span class="ticket-badge badge-load-green">0 offen</span>`;
  const percent = Math.round((openCount / totalOpen) * 100);
  let cls = 'badge-load-green';
  if (percent > 75) cls = 'badge-load-violet';
  else if (percent > 50) cls = 'badge-load-red';
  else if (percent > 25) cls = 'badge-load-yellow';
  return `<span class="ticket-badge ${cls}" title="${percent}% der offenen Tickets">${openCount} offen · ${percent}%</span>`;
}

function renderCategoryCards() {
  const container = document.getElementById('categoryCards');
  if (!adminCategories.length) {
    container.innerHTML = '<p class="text-muted small">Keine Kategorien konfiguriert.</p>';
    return;
  }
  const totalOpen = adminCategories.reduce((sum, c) => sum + (c.open_count || 0), 0);

  container.innerHTML = adminCategories.map(c => `
    <div class="col-md-6 col-lg-4">
      <div class="card bg-dark-card border-0 shadow-sm h-100">
        <div class="card-body">
          <div class="d-flex align-items-center justify-content-between mb-2">
            <span class="fw-semibold">${escapeHtml(c.emoji || '')} ${escapeHtml(c.name)}</span>
            <button class="btn btn-sm btn-outline-primary" onclick="openCategoryEdit(${escapeHtml(JSON.stringify(c.name))})">
              <i class="bi bi-pencil-fill"></i>
            </button>
          </div>
          <div class="mb-2">${loadBadge(c.open_count || 0, totalOpen)}</div>
          <p class="text-muted small mb-1">
            <i class="bi bi-card-text me-1"></i>
            ${c.description ? escapeHtml(c.description) : '<span class="fst-italic">Keine Beschreibung</span>'}
          </p>
          <p class="text-muted small mb-1">
            <i class="bi bi-chat-left-text me-1"></i>
            ${c.welcome_message ? escapeHtml(c.welcome_message.substring(0, 80)) + (c.welcome_message.length > 80 ? '…' : '') : '<span class="fst-italic">Keine Willkommensnachricht</span>'}
          </p>
          <p class="text-muted small mb-0">
            <i class="bi bi-send me-1"></i>
            ${c.auto_message ? escapeHtml(c.auto_message.substring(0, 80)) + (c.auto_message.length > 80 ? '…' : '') : '<span class="fst-italic">Keine Auto-Nachricht</span>'}
          </p>
        </div>
      </div>
    </div>`).join('');
}

function fillCategoryForm(c) {
  document.getElementById('catEditNameInput').value    = c?.name || '';
  document.getElementById('catEditEmoji').value        = c?.emoji || '';
  document.getElementById('catEditDescription').value  = c?.description || '';
  document.getElementById('catEditPingRole').value     = c?.ping_target_id || '';
  document.getElementById('catEditWelcome').value      = c?.welcome_message || '';
  document.getElementById('catEditAutoMsg').value      = c?.auto_message || '';
  document.getElementById('catEditAutoChannel').checked = c ? !!c.auto_message_channel : true;
  document.getElementById('catEditAutoDm').checked      = c ? !!c.auto_message_dm : false;
  document.getElementById('catEditAlert').className     = 'alert d-none';
}

function openCategoryEdit(name) {
  const c = adminCategories.find(x => x.name === name);
  if (!c) return;
  document.getElementById('catEditTitle').innerHTML = `<i class="bi bi-pencil-fill text-primary me-2"></i>Kategorie bearbeiten`;
  document.getElementById('catEditIsNew').value         = 'false';
  document.getElementById('catEditOriginalName').value  = c.name;
  document.getElementById('catEditNameInput').readOnly  = true;
  document.getElementById('catEditDeleteBtn').classList.remove('d-none');
  fillCategoryForm(c);
  new bootstrap.Modal(document.getElementById('catEditModal')).show();
}

function openCategoryCreate() {
  document.getElementById('catEditTitle').innerHTML = `<i class="bi bi-plus-circle-fill text-primary me-2"></i>Neue Kategorie`;
  document.getElementById('catEditIsNew').value         = 'true';
  document.getElementById('catEditOriginalName').value  = '';
  document.getElementById('catEditNameInput').readOnly  = false;
  document.getElementById('catEditDeleteBtn').classList.add('d-none');
  fillCategoryForm(null);
  new bootstrap.Modal(document.getElementById('catEditModal')).show();
}

async function saveCategoryEdit() {
  const isNew        = document.getElementById('catEditIsNew').value === 'true';
  const originalName = document.getElementById('catEditOriginalName').value;
  const alertEl       = document.getElementById('catEditAlert');

  const payload = {
    emoji:                 document.getElementById('catEditEmoji').value.trim(),
    description:           document.getElementById('catEditDescription').value.trim(),
    ping_target_id:        document.getElementById('catEditPingRole').value,
    welcome_message:       document.getElementById('catEditWelcome').value.trim(),
    auto_message:          document.getElementById('catEditAutoMsg').value.trim(),
    auto_message_channel:  document.getElementById('catEditAutoChannel').checked ? 1 : 0,
    auto_message_dm:       document.getElementById('catEditAutoDm').checked      ? 1 : 0,
  };
  if (isNew) payload.name = document.getElementById('catEditNameInput').value.trim();
  if (isNew && !payload.name) {
    alertEl.className = 'alert alert-danger'; alertEl.textContent = 'Bitte einen Namen angeben.'; return;
  }

  alertEl.className   = 'alert alert-info';
  alertEl.textContent = 'Speichern…';
  try {
    const res = isNew
      ? await apiFetch('/api/admin/categories', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        })
      : await apiFetch(`/api/admin/categories/${encodeURIComponent(originalName)}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
        });
    const data = await res.json();
    if (res.ok) {
      alertEl.className   = 'alert alert-success';
      alertEl.textContent = '✓ Gespeichert';
      await loadCategorySettings();
      setTimeout(() => bootstrap.Modal.getInstance(document.getElementById('catEditModal'))?.hide(), 800);
    } else {
      alertEl.className   = 'alert alert-danger';
      alertEl.textContent = data.error || 'Fehler';
    }
  } catch {
    alertEl.className   = 'alert alert-danger';
    alertEl.textContent = 'Netzwerkfehler';
  }
}

async function deleteCategoryConfirm() {
  const name = document.getElementById('catEditOriginalName').value;
  if (!name) return;
  if (!confirm(`Kategorie "${name}" wirklich löschen? Bestehende Tickets bleiben erhalten, behalten aber den alten Kategorienamen.`)) return;

  const alertEl = document.getElementById('catEditAlert');
  try {
    const res  = await apiFetch(`/api/admin/categories/${encodeURIComponent(name)}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      await loadCategorySettings();
      bootstrap.Modal.getInstance(document.getElementById('catEditModal'))?.hide();
    } else {
      alertEl.className = 'alert alert-danger';
      alertEl.textContent = data.error || 'Fehler beim Löschen';
    }
  } catch {
    alertEl.className = 'alert alert-danger';
    alertEl.textContent = 'Netzwerkfehler';
  }
}

// ── Tickets: read-only overview ─────────────────────────────────────────────
let allTickets = [];

function statusBadge(status) {
  const cls   = status === 'open' ? 'badge-open'   : 'badge-closed';
  const label = status === 'open' ? 'Offen'        : 'Geschlossen';
  const icon  = status === 'open' ? 'bi-circle-fill' : 'bi-lock-fill';
  return `<span class="ticket-badge ${cls}"><i class="bi ${icon} me-1" style="font-size:.6rem"></i>${label}</span>`;
}
function categoryClass(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return `badge-cat-${(hash % 6) + 1}`;
}
function catBadge(cat) {
  return `<span class="ticket-badge ${categoryClass(cat)}">${escapeHtml(cat)}</span>`;
}

async function loadStats() {
  try {
    const stats = await apiFetch('/api/stats').then(r => r.json());
    document.getElementById('statTotal').textContent  = stats.total  ?? 0;
    document.getElementById('statOpen').textContent   = stats.open   ?? 0;
    document.getElementById('statClosed').textContent = stats.closed ?? 0;
  } catch { /* ignore */ }
}

async function loadTickets() {
  const tbody = document.getElementById('ticketTableBody');
  tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">
    <div class="spinner-border spinner-border-sm me-2" role="status"></div>Lade…</td></tr>`;

  const res = await apiFetch('/api/tickets');
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">Fehler beim Laden.</td></tr>`;
    return;
  }
  const data = await res.json();
  allTickets = data.tickets;

  const cats = [...new Set(allTickets.map(t => t.category))].sort();
  const filterSelect = document.getElementById('categoryFilter');
  const current = filterSelect.value;
  filterSelect.innerHTML = `<option value="">Alle Kategorien</option>` +
    cats.map(c => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  filterSelect.value = current;

  renderTicketTable();
}

function renderTicketTable() {
  const search   = document.getElementById('searchInput').value.toLowerCase();
  const status   = document.getElementById('statusFilter').value;
  const category = document.getElementById('categoryFilter').value;

  const filtered = allTickets.filter(t => {
    if (status   && t.status   !== status)   return false;
    if (category && t.category !== category) return false;
    if (search) {
      const h = `${t.subject} ${t.username} ${t.category}`.toLowerCase();
      if (!h.includes(search)) return false;
    }
    return true;
  });

  const tbody = document.getElementById('ticketTableBody');
  const empty = document.getElementById('emptyHint');

  if (!filtered.length) { tbody.innerHTML = ''; empty.classList.remove('d-none'); return; }
  empty.classList.add('d-none');

  tbody.innerHTML = filtered.map(t => `
    <tr onclick="window.location='/admin/ticket/${t.id}'" style="cursor:pointer">
      <td class="text-muted fw-mono">#${String(t.ticket_number).padStart(4,'0')}</td>
      <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${escapeHtml(t.subject || '(kein Betreff)')}
      </td>
      <td>${catBadge(t.category)}</td>
      <td>${escapeHtml(t.username)}</td>
      <td>${statusBadge(t.status)}</td>
      <td class="text-muted small">${formatDate(t.created_at)}</td>
      <td class="text-end"><i class="bi bi-chevron-right text-muted"></i></td>
    </tr>
  `).join('');
}

document.getElementById('searchInput').addEventListener('input', renderTicketTable);
document.getElementById('statusFilter').addEventListener('change', renderTicketTable);
document.getElementById('categoryFilter').addEventListener('change', renderTicketTable);

// ── License ───────────────────────────────────────────────────────────────────
function licenseStatusBadge(status) {
  return status === 'active'
    ? '<span class="ticket-badge badge-open">✅ Aktiv</span>'
    : '<span class="ticket-badge badge-closed">🔒 Gesperrt</span>';
}

async function loadLicenseStatus() {
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
  if (currentUser?.isSuperAdmin) loadAdminLicenses();
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
      await loadLicenseStatus();
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

// ── Bot-Admin: cross-guild license management ────────────────────────────────
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
        <td>${licenseStatusBadge(l.status)}</td>
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
  const alertEl   = document.getElementById('createLicenseAlert');

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

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  const ok = await loadUser();
  if (!ok) return;
  const initialTab = window.location.hash === '#license' ? 'license' : 'categories';
  switchTab(initialTab);
})();
