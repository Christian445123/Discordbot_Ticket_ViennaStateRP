'use strict';

let currentUser  = null;
let activeTab    = 'categories'; // 'categories' | 'tickets'

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
  return true;
}

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTab(tab) {
  activeTab = tab;
  ['categories', 'tickets'].forEach(t => {
    document.getElementById(`pane-${t}`)?.classList.toggle('d-none', t !== tab);
    document.getElementById(`tab-${t}`)?.classList.toggle('active', t === tab);
  });
  if (tab === 'categories') loadCategorySettings();
  if (tab === 'tickets')    { loadStats(); loadTickets(); }
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
          <p class="text-muted small mb-0 mt-1">
            <i class="bi bi-list-check me-1"></i>
            ${c.questions?.length ? `${c.questions.length} eigene Frage(n)` : 'Standard-Formular (Betreff, Beschreibung)'}
          </p>
        </div>
      </div>
    </div>`).join('');
}

// ── Question editor (per-category ticket-creation questions) ─────────────────
const MAX_QUESTIONS = 5;

function questionRowHtml(q) {
  q = q || {};
  return `
    <div class="row g-2 align-items-center mb-2 question-row">
      <div class="col-6">
        <input type="text" class="form-control form-control-sm q-label" maxlength="45" placeholder="Frage" value="${escapeHtml(q.label || '')}" />
      </div>
      <div class="col-3">
        <select class="form-select form-select-sm q-style">
          <option value="short" ${q.style !== 'paragraph' ? 'selected' : ''}>Kurz</option>
          <option value="paragraph" ${q.style === 'paragraph' ? 'selected' : ''}>Absatz</option>
        </select>
      </div>
      <div class="col-2 form-check form-switch">
        <input class="form-check-input q-required" type="checkbox" ${q.required !== false ? 'checked' : ''} />
        <label class="form-check-label small text-muted">Pflicht</label>
      </div>
      <div class="col-1 text-end">
        <button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('.question-row').remove()">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
    </div>`;
}

function addQuestionRow(q) {
  const container = document.getElementById('catEditQuestions');
  if (container.children.length >= MAX_QUESTIONS) return;
  container.insertAdjacentHTML('beforeend', questionRowHtml(q));
}

function renderQuestionRows(questionList) {
  const container = document.getElementById('catEditQuestions');
  container.innerHTML = '';
  (questionList || []).forEach(q => addQuestionRow(q));
}

function collectQuestions() {
  return Array.from(document.querySelectorAll('#catEditQuestions .question-row')).map(row => ({
    label:    row.querySelector('.q-label').value.trim(),
    style:    row.querySelector('.q-style').value,
    required: row.querySelector('.q-required').checked,
  })).filter(q => q.label);
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
  renderQuestionRows(c?.questions || []);
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
    questions:             collectQuestions(),
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

// ── Stats & global workload overview ("Auslastung") ─────────────────────────
function formatMinutes(minutes) {
  if (minutes == null) return 'noch keine geschlossenen Tickets';
  if (minutes < 60) return `${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  const rest  = minutes % 60;
  if (hours < 24) return rest ? `${hours} Std. ${rest} Min.` : `${hours} Std.`;
  const days     = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} Tag(e) ${restHours} Std.` : `${days} Tag(e)`;
}

function workloadBarColor(percent) {
  if (percent > 75) return 'badge-load-violet';
  if (percent > 50) return 'badge-load-red';
  if (percent > 25) return 'badge-load-yellow';
  return 'badge-load-green';
}

function renderWorkload(data) {
  const container = document.getElementById('workloadBars');
  const avgEl      = document.getElementById('workloadAvgResolution');
  avgEl.textContent = `Ø Bearbeitungsdauer: ${formatMinutes(data.avgResolutionMinutes)}`;

  const byCategory = data.byCategory || [];
  const totalOpen  = byCategory.reduce((sum, c) => sum + (c.open_count || 0), 0);
  if (!byCategory.length) {
    container.innerHTML = '<p class="text-muted small mb-0">Keine Kategorien konfiguriert.</p>';
    return;
  }
  if (!totalOpen) {
    container.innerHTML = '<p class="text-muted small mb-0">Aktuell keine offenen Tickets.</p>';
    return;
  }

  container.innerHTML = byCategory
    .filter(c => c.open_count > 0)
    .sort((a, b) => b.open_count - a.open_count)
    .map(c => {
      const percent = Math.round((c.open_count / totalOpen) * 100);
      return `
        <div class="mb-2">
          <div class="d-flex justify-content-between small mb-1">
            <span>${escapeHtml(c.emoji || '')} ${escapeHtml(c.name)}</span>
            <span class="text-muted">${c.open_count} offen · ${percent}%</span>
          </div>
          <div class="progress" style="height:6px;background-color:var(--bg-dark)">
            <div class="progress-bar ${workloadBarColor(percent)}" style="width:${percent}%;background-color:currentColor"></div>
          </div>
        </div>`;
    }).join('');
}

async function loadStats() {
  const workloadContainer = document.getElementById('workloadBars');
  workloadContainer.innerHTML = '<p class="text-muted small mb-0">Lade…</p>';
  try {
    const res = await apiFetch('/api/stats');
    if (!res.ok) {
      workloadContainer.innerHTML = '<p class="text-danger small mb-0">Fehler beim Laden.</p>';
      return;
    }
    const stats = await res.json();
    document.getElementById('statTotal').textContent  = stats.total  ?? 0;
    document.getElementById('statOpen').textContent   = stats.open   ?? 0;
    document.getElementById('statClosed').textContent = stats.closed ?? 0;
    renderWorkload(stats);
  } catch {
    workloadContainer.innerHTML = '<p class="text-danger small mb-0">Netzwerkfehler.</p>';
  }
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

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  const ok = await loadUser();
  if (!ok) return;
  switchTab('categories');
})();
