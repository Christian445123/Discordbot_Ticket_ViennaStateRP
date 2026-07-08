'use strict';

let allTickets = [];

// ── Helpers ───────────────────────────────────────────────────────────────────
function formatDate(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('de-AT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function statusBadge(status) {
  const cls   = status === 'open' ? 'badge-open' : 'badge-closed';
  const label = status === 'open' ? 'Offen' : 'Geschlossen';
  const icon  = status === 'open' ? 'bi-circle-fill' : 'bi-lock-fill';
  return `<span class="ticket-badge ${cls}"><i class="bi ${icon} me-1" style="font-size:.6rem"></i>${label}</span>`;
}

function catBadge(cat) {
  return `<span class="ticket-badge badge-cat">${cat}</span>`;
}

// ── Load user info ────────────────────────────────────────────────────────────
async function loadUser() {
  try {
    const res  = await fetch('/api/me');
    if (!res.ok) { window.location.href = '/'; return; }
    const user = await res.json();

    document.getElementById('userInfo').innerHTML = `
      <img src="${user.avatar}" class="user-avatar" alt="${user.username}" />
      <span class="fw-semibold">${user.username}</span>
      ${user.isStaff ? '<span class="ticket-badge badge-open ms-1">Staff</span>' : ''}
    `;
  } catch {
    window.location.href = '/';
  }
}

// ── Load stats ────────────────────────────────────────────────────────────────
async function loadStats() {
  try {
    const res   = await fetch('/api/stats');
    const stats = await res.json();
    document.getElementById('statTotal').textContent  = stats.total  ?? 0;
    document.getElementById('statOpen').textContent   = stats.open   ?? 0;
    document.getElementById('statClosed').textContent = stats.closed ?? 0;
  } catch { /* ignore */ }
}

// ── Load tickets ──────────────────────────────────────────────────────────────
async function loadTickets() {
  const tbody = document.getElementById('ticketTableBody');
  tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted py-4">
    <div class="spinner-border spinner-border-sm me-2" role="status"></div>Lade…</td></tr>`;

  try {
    const res = await fetch('/api/tickets');
    if (!res.ok) throw new Error();
    allTickets = await res.json();
  } catch {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">Fehler beim Laden der Tickets.</td></tr>`;
    return;
  }

  renderTable();
}

// ── Render table ──────────────────────────────────────────────────────────────
function renderTable() {
  const search   = document.getElementById('searchInput').value.toLowerCase();
  const status   = document.getElementById('statusFilter').value;
  const category = document.getElementById('categoryFilter').value;

  const filtered = allTickets.filter(t => {
    if (status   && t.status   !== status)   return false;
    if (category && t.category !== category) return false;
    if (search) {
      const haystack = `${t.subject} ${t.username} ${t.category}`.toLowerCase();
      if (!haystack.includes(search)) return false;
    }
    return true;
  });

  const tbody = document.getElementById('ticketTableBody');
  const empty = document.getElementById('emptyHint');

  if (filtered.length === 0) {
    tbody.innerHTML = '';
    empty.classList.remove('d-none');
    return;
  }
  empty.classList.add('d-none');

  tbody.innerHTML = filtered.map(t => `
    <tr onclick="window.location='/ticket/${t.id}'">
      <td class="fw-mono text-muted">#${String(t.ticket_number).padStart(4, '0')}</td>
      <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
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

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ── Event listeners ───────────────────────────────────────────────────────────
document.getElementById('searchInput').addEventListener('input', renderTable);
document.getElementById('statusFilter').addEventListener('change', renderTable);
document.getElementById('categoryFilter').addEventListener('change', renderTable);

// ── Init ──────────────────────────────────────────────────────────────────────
loadUser();
loadStats();
loadTickets();
