'use strict';

let allTickets  = [];
let currentUser = null;
let categories  = [];
let activeTab   = 'mine'; // 'mine' | 'all'

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('de-AT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}
function statusBadge(status) {
  const cls   = status === 'open' ? 'badge-open'   : 'badge-closed';
  const label = status === 'open' ? 'Offen'        : 'Geschlossen';
  const icon  = status === 'open' ? 'bi-circle-fill' : 'bi-lock-fill';
  return `<span class="ticket-badge ${cls}"><i class="bi ${icon} me-1" style="font-size:.6rem"></i>${label}</span>`;
}
// Categories are admin-defined (see /kategorie-config), so badge color is
// derived deterministically from the name instead of a fixed lookup table.
function categoryClass(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return `badge-cat-${(hash % 6) + 1}`;
}
function catBadge(cat) {
  return `<span class="ticket-badge ${categoryClass(cat)}">${escapeHtml(cat)}</span>`;
}
function escapeHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Load user ─────────────────────────────────────────────────────────────────
async function loadUser() {
  const res = await apiFetch('/api/me');
  if (!res.ok) { window.location.href = '/'; return; }
  currentUser = await res.json();

  document.getElementById('userInfo').innerHTML = `
    <img src="${currentUser.avatar}" class="user-avatar" alt="${escapeHtml(currentUser.username)}" />
    <span class="fw-semibold">${escapeHtml(currentUser.username)}</span>
    ${currentUser.isStaff ? '<span class="ticket-badge badge-open ms-1">Staff</span>' : ''}
  `;

  // Show "Alle Tickets" + "Einstellungen" tabs for staff
  if (currentUser.isStaff) {
    document.getElementById('tab-all').classList.remove('d-none');
    document.getElementById('tab-settings').classList.remove('d-none');
  }
  // Hide "Benutzer" column when viewing own tickets
  updateColumnVisibility();
}

// ── Load categories ───────────────────────────────────────────────────────────
async function loadCategories() {
  try {
    const res  = await apiFetch('/api/categories');
    const data = await res.json();
    categories = Array.isArray(data) ? data : [];
  } catch { categories = []; }

  const filterOptions = categories
    .map(c => `<option value="${escapeHtml(c.name)}">${c.emoji ? `${c.emoji} ` : ''}${escapeHtml(c.name)}</option>`)
    .join('');
  document.getElementById('categoryFilter').innerHTML = `<option value="">Alle Kategorien</option>${filterOptions}`;

  const createOptions = categories
    .map(c => `<option value="${escapeHtml(c.name)}">${c.emoji ? `${c.emoji} ` : ''}${escapeHtml(c.name)}</option>`)
    .join('');
  document.getElementById('createCategory').innerHTML = `<option value="">— Bitte wählen —</option>${createOptions}`;
}

// ── Load stats ────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const stats = await apiFetch('/api/stats').then(r => r.json());
    document.getElementById('statTotal').textContent  = stats.total  ?? 0;
    document.getElementById('statOpen').textContent   = stats.open   ?? 0;
    document.getElementById('statClosed').textContent = stats.closed ?? 0;
  } catch { /* ignore */ }
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(tab) {
  activeTab = tab;
  document.getElementById('tab-mine').classList.toggle('active', tab === 'mine');
  document.getElementById('tab-all').classList.toggle('active',  tab === 'all');
  document.getElementById('tab-settings').classList.toggle('active', tab === 'settings');

  const isSettings = tab === 'settings';
  document.querySelector('.d-flex.flex-wrap.gap-2.align-items-center.mb-3')?.classList.toggle('d-none', isSettings);
  document.querySelector('.card.bg-dark-card')?.classList.toggle('d-none', isSettings);
  document.getElementById('emptyHint').classList.add('d-none');
  document.getElementById('settingsPanel').classList.toggle('d-none', !isSettings);

  if (isSettings) {
    loadCategorySettings();
  } else {
    updateColumnVisibility();
    loadTickets();
  }
}

function updateColumnVisibility() {
  const col = document.getElementById('colUser');
  if (col) col.style.display = activeTab === 'all' ? '' : 'none';
  document.querySelectorAll('.col-user').forEach(el => {
    el.style.display = activeTab === 'all' ? '' : 'none';
  });
}

// ── Load tickets ──────────────────────────────────────────────────────────────
async function loadTickets() {
  const tbody = document.getElementById('ticketTableBody');
  tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">
    <div class="spinner-border spinner-border-sm me-2" role="status"></div>Lade…</td></tr>`;

  const own = activeTab === 'mine' ? '&own=true' : '';
  const res = await apiFetch(`/api/tickets?${own}`);
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">Fehler beim Laden.</td></tr>`;
    return;
  }
  const data  = await res.json();
  allTickets  = data.tickets;
  if (!currentUser) currentUser = { isStaff: data.isStaff };
  renderTable();
}

// ── Render table ──────────────────────────────────────────────────────────────
function renderTable() {
  const search   = document.getElementById('searchInput').value.toLowerCase();
  const status   = document.getElementById('statusFilter').value;
  const category = document.getElementById('categoryFilter').value;
  const showUser = activeTab === 'all';

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
    <tr onclick="window.location='/ticket/${t.id}'" style="cursor:pointer">
      <td class="text-muted fw-mono">#${String(t.ticket_number).padStart(4,'0')}</td>
      <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${escapeHtml(t.subject || '(kein Betreff)')}
      </td>
      <td>${catBadge(t.category)}</td>
      <td class="col-user" style="display:${showUser?'':'none'}">${escapeHtml(t.username)}</td>
      <td>${statusBadge(t.status)}</td>
      <td class="text-muted small">${formatDate(t.created_at)}</td>
      <td class="text-end"><i class="bi bi-chevron-right text-muted"></i></td>
    </tr>
  `).join('');
}

// ── Create ticket ─────────────────────────────────────────────────────────────
async function submitCreateTicket() {
  const category    = document.getElementById('createCategory').value;
  const subject     = document.getElementById('createSubject').value.trim();
  const description = document.getElementById('createDescription').value.trim();
  const alert       = document.getElementById('createAlert');
  const btn         = document.getElementById('createSubmitBtn');

  alert.className = 'alert d-none';

  if (!category) { showCreateAlert('danger', 'Bitte eine Kategorie wählen.'); return; }
  if (!subject)  { showCreateAlert('danger', 'Bitte einen Betreff eingeben.'); return; }

  btn.disabled    = true;
  btn.textContent = 'Erstelle…';

  try {
    const res  = await apiFetch('/api/tickets', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ category, subject, description }),
    });
    const data = await res.json();

    if (res.ok) {
      window.location.href = `/ticket/${data.ticketId}`;
    } else if (res.status === 400 && data.ticketId) {
      window.location.href = `/ticket/${data.ticketId}`;
    } else {
      showCreateAlert('danger', data.error || 'Fehler beim Erstellen.');
      btn.disabled    = false;
      btn.innerHTML   = '<i class="bi bi-send-fill me-1"></i>Ticket erstellen';
    }
  } catch {
    showCreateAlert('danger', 'Netzwerkfehler.');
    btn.disabled    = false;
    btn.innerHTML   = '<i class="bi bi-send-fill me-1"></i>Ticket erstellen';
  }
}

function showCreateAlert(type, msg) {
  const el = document.getElementById('createAlert');
  el.className = `alert alert-${type}`;
  el.textContent = msg;
}

// ── Category settings (Staff) ─────────────────────────────────────────────────
let adminCategories = [];

async function loadCategorySettings() {
  const container = document.getElementById('categoryCards');
  container.innerHTML = '<p class="text-muted small">Lade Kategorien…</p>';
  try {
    const res  = await apiFetch('/api/admin/categories');
    if (!res.ok) { container.innerHTML = '<p class="text-danger small">Fehler beim Laden.</p>'; return; }
    adminCategories = await res.json();
    renderCategoryCards();
  } catch {
    container.innerHTML = '<p class="text-danger small">Netzwerkfehler.</p>';
  }
}

function renderCategoryCards() {
  const container = document.getElementById('categoryCards');
  if (!adminCategories.length) {
    container.innerHTML = '<p class="text-muted small">Keine Kategorien konfiguriert.</p>';
    return;
  }
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

function openCategoryEdit(name) {
  const c = adminCategories.find(x => x.name === name);
  if (!c) return;
  document.getElementById('catEditTitle').innerHTML =
    `<i class="bi bi-pencil-fill text-primary me-2"></i>${escapeHtml(c.emoji || '')} ${escapeHtml(c.name)} bearbeiten`;
  document.getElementById('catEditName').value          = c.name;
  document.getElementById('catEditWelcome').value       = c.welcome_message || '';
  document.getElementById('catEditAutoMsg').value       = c.auto_message    || '';
  document.getElementById('catEditAutoChannel').checked = !!c.auto_message_channel;
  document.getElementById('catEditAutoDm').checked      = !!c.auto_message_dm;
  document.getElementById('catEditAlert').className     = 'alert d-none';
  new bootstrap.Modal(document.getElementById('catEditModal')).show();
}

async function saveCategoryEdit() {
  const name    = document.getElementById('catEditName').value;
  const alert   = document.getElementById('catEditAlert');
  const payload = {
    welcome_message:      document.getElementById('catEditWelcome').value.trim(),
    auto_message:         document.getElementById('catEditAutoMsg').value.trim(),
    auto_message_channel: document.getElementById('catEditAutoChannel').checked ? 1 : 0,
    auto_message_dm:      document.getElementById('catEditAutoDm').checked      ? 1 : 0,
  };
  alert.className   = 'alert alert-info';
  alert.textContent = 'Speichern…';
  try {
    const res = await apiFetch(`/api/admin/categories/${encodeURIComponent(name)}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) {
      alert.className   = 'alert alert-success';
      alert.textContent = '✓ Gespeichert';
      await loadCategorySettings();
      setTimeout(() => bootstrap.Modal.getInstance(document.getElementById('catEditModal'))?.hide(), 800);
    } else {
      alert.className   = 'alert alert-danger';
      alert.textContent = data.error || 'Fehler';
    }
  } catch {
    alert.className   = 'alert alert-danger';
    alert.textContent = 'Netzwerkfehler';
  }
}

// ── Event listeners ───────────────────────────────────────────────────────────
document.getElementById('searchInput').addEventListener('input', renderTable);
document.getElementById('statusFilter').addEventListener('change', renderTable);
document.getElementById('categoryFilter').addEventListener('change', renderTable);

// Reset modal on close
document.getElementById('createModal')?.addEventListener('hidden.bs.modal', () => {
  document.getElementById('createCategory').value    = '';
  document.getElementById('createSubject').value     = '';
  document.getElementById('createDescription').value = '';
  document.getElementById('createAlert').className   = 'alert d-none';
  const btn = document.getElementById('createSubmitBtn');
  btn.disabled  = false;
  btn.innerHTML = '<i class="bi bi-send-fill me-1"></i>Ticket erstellen';
});

// ── Init ──────────────────────────────────────────────────────────────────────
loadUser();
loadCategories();
loadStats();
loadTickets();
