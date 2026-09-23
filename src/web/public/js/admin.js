'use strict';

let currentUser  = null;
let activeTab    = 'categories'; // 'categories' | 'tickets' | 'system' | 'voice'

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
  ['categories', 'tickets', 'system', 'voice', 'moderation'].forEach(t => {
    document.getElementById(`pane-${t}`)?.classList.toggle('d-none', t !== tab);
    document.getElementById(`tab-${t}`)?.classList.toggle('active', t === tab);
  });
  if (tab === 'categories') loadCategorySettings();
  if (tab === 'tickets')    { loadStats(); loadTickets(); }
  if (tab === 'voice')      loadVoiceSupportSettings();
  if (tab === 'moderation') loadModerationSettings();
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

  const container = document.getElementById('catEditPingRoles');
  container.innerHTML = guildRoles.length
    ? guildRoles.map(r => `
        <div class="form-check">
          <input class="form-check-input ping-role-checkbox" type="checkbox" value="${r.id}" id="pingRole-${r.id}" />
          <label class="form-check-label small" for="pingRole-${r.id}">${escapeHtml(r.name)}</label>
        </div>`).join('')
    : '<p class="text-muted small mb-0">Keine Rollen gefunden.</p>';
}

function collectPingRoleIds() {
  return Array.from(document.querySelectorAll('#catEditPingRoles .ping-role-checkbox:checked')).map(cb => cb.value);
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
          <div class="mb-2">
            ${loadBadge(c.open_count || 0, totalOpen)}
            ${c.locked ? '<span class="ticket-badge badge-load-red ms-1">🔒 Gesperrt</span>' : ''}
          </div>
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
          <p class="text-muted small mb-0 mt-1">
            <i class="bi bi-person-fill-lock me-1"></i>
            ${c.max_open_tickets != null ? `Max. ${c.max_open_tickets} offene(s) Ticket(s)/Nutzer` : 'Unbegrenzt offene Tickets/Nutzer'}
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
  document.getElementById('catEditMaxOpenTickets').value = c ? (c.max_open_tickets ?? '') : '1';
  document.getElementById('catEditLocked').checked     = c ? !!c.locked : false;
  document.getElementById('catEditWelcome').value      = c?.welcome_message || '';
  document.getElementById('catEditAutoMsg').value      = c?.auto_message || '';
  document.getElementById('catEditAutoChannel').checked = c ? !!c.auto_message_channel : true;
  document.getElementById('catEditAutoDm').checked      = c ? !!c.auto_message_dm : false;
  document.getElementById('catEditAlert').className     = 'alert d-none';
  renderQuestionRows(c?.questions || []);

  const checkedRoleIds = new Set(c?.ping_role_ids || []);
  document.querySelectorAll('#catEditPingRoles .ping-role-checkbox').forEach(cb => {
    cb.checked = checkedRoleIds.has(cb.value);
  });
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
    max_open_tickets:      document.getElementById('catEditMaxOpenTickets').value.trim(),
    locked:                document.getElementById('catEditLocked').checked ? 1 : 0,
    ping_role_ids:         collectPingRoleIds(),
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

// "In Bearbeitung" and "Warte auf Rückmeldung" aren't stored statuses —
// they're status='open' with claimed_by_id / on_hold_by_id set (see
// db.js/routes.js's POST /tickets/:id/claim and /tickets/:id/hold, and the
// Discord-side buttons). The two are independent (a ticket can be both
// claimed and on hold), so on-hold takes display priority over in-progress.
function ticketDisplayStatus(t) {
  if (t.status === 'closed') return 'closed';
  if (t.on_hold_by_id) return 'on_hold';
  return t.claimed_by_id ? 'in_progress' : 'open';
}

const STATUS_META = {
  open:        { cls: 'badge-open',     label: 'Offen',               icon: 'bi-circle-fill' },
  in_progress: { cls: 'badge-progress', label: 'In Bearbeitung',      icon: 'bi-person-fill-gear' },
  on_hold:     { cls: 'badge-hold',     label: 'Warte auf Rückmeldung', icon: 'bi-pause-circle-fill' },
  closed:      { cls: 'badge-closed',   label: 'Geschlossen',         icon: 'bi-lock-fill' },
};

function statusBadge(t) {
  const { cls, label, icon } = STATUS_META[ticketDisplayStatus(t)];
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
    if (status   && ticketDisplayStatus(t) !== status) return false;
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
      <td class="text-muted fw-mono">#${String(t.ticket_number).padStart(3,'0')}</td>
      <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
        ${escapeHtml(t.subject || '(kein Betreff)')}
      </td>
      <td>${catBadge(t.category)}</td>
      <td>${escapeHtml(t.username)}</td>
      <td>${statusBadge(t)}</td>
      <td class="text-muted small">${formatDate(t.created_at)}</td>
      <td class="text-end"><i class="bi bi-chevron-right text-muted"></i></td>
    </tr>
  `).join('');
}

document.getElementById('searchInput').addEventListener('input', renderTicketTable);
document.getElementById('statusFilter').addEventListener('change', renderTicketTable);
document.getElementById('categoryFilter').addEventListener('change', renderTicketTable);

// ── System: deploy & restart ──────────────────────────────────────────────────
// Same behavior as the sibling Discordbot_Follower project's webpanel: git
// pull (fast-forward only) + conditional npm install, and a restart that
// just kills the process for PM2's autorestart to bring back up. Affects the
// whole bot process (every guild it serves), not just the one currently
// selected in the panel.
async function postSystem(action) {
  const res  = await apiFetch(`/api/admin/system/${action}`, { method: 'POST' });
  const data = await res.json();
  return { ok: res.ok, data };
}

async function triggerDeploy() {
  if (!confirm('Neuesten Stand aus dem Git-Repository laden (git pull)? Bei Änderungen startet der Bot danach automatisch neu.')) return;
  const btn    = document.getElementById('deployBtn');
  const result = document.getElementById('deployResult');
  btn.disabled = true;
  result.className   = 'small';
  result.textContent = '⏳ Deploye …';
  try {
    const { ok, data } = await postSystem('deploy');
    if (ok) {
      result.className = data.npmInstallError ? 'small text-danger' : 'small text-success';
      let text = data.output || '(keine Ausgabe)';
      if (data.npmInstallRan)   text += '\n\nnpm install erfolgreich ausgeführt.';
      if (data.npmInstallError) text += `\n\nnpm install fehlgeschlagen:\n${data.npmInstallError}\n\nBot wurde NICHT neugestartet.`;
      if (data.restarting)      text += '\n\nBot startet neu, Seite lädt in Kürze neu …';
      result.textContent = text;
      if (data.restarting) { setTimeout(() => location.reload(), 8000); return; }
    } else {
      result.className   = 'small text-danger';
      result.textContent = `❌ ${data.error || 'Unbekannter Fehler'}`;
    }
  } catch {
    result.className   = 'small text-danger';
    result.textContent = '❌ Netzwerkfehler';
  }
  btn.disabled = false;
}

async function triggerRestart() {
  if (!confirm('Bot wirklich neustarten? Er ist danach für wenige Sekunden nicht erreichbar.')) return;
  const btn    = document.getElementById('restartBtn');
  const result = document.getElementById('restartResult');
  btn.disabled = true;
  result.className   = 'small';
  result.textContent = '⏳ Neustart wird ausgelöst …';
  try {
    const { ok, data } = await postSystem('restart');
    if (ok) {
      result.className   = 'small text-success';
      result.textContent = '✓ Neustart ausgelöst. Seite lädt in Kürze neu …';
      setTimeout(() => location.reload(), 8000);
      return;
    }
    result.className   = 'small text-danger';
    result.textContent = `❌ ${data.error || 'Unbekannter Fehler'}`;
  } catch {
    result.className   = 'small text-danger';
    result.textContent = '❌ Netzwerkfehler';
  }
  btn.disabled = false;
}

// ── Voice-Support (Warteraum, Benachrichtigung, Supportzeiten) ──────────────
// Weekday order shown to the admin (Mo..So), mapped to the JS Date.getDay()
// convention (0=So..6=Sa) the backend/DB use — VOICE_WEEKDAY_ORDER[i] is the
// weekday value stored for the i-th row on screen.
const VOICE_WEEKDAY_ORDER  = [1, 2, 3, 4, 5, 6, 0];
const VOICE_WEEKDAY_LABELS = { 0: 'Sonntag', 1: 'Montag', 2: 'Dienstag', 3: 'Mittwoch', 4: 'Donnerstag', 5: 'Freitag', 6: 'Samstag' };

async function loadVoiceSupportChannelOptions() {
  const [voiceRes, textRes, rolesRes, categoriesRes] = await Promise.all([
    apiFetch('/api/admin/voice-support/channels?type=voice'),
    apiFetch('/api/admin/voice-support/channels?type=text'),
    apiFetch('/api/admin/guild-roles'),
    apiFetch('/api/admin/categories'),
  ]);
  const voiceChannels = voiceRes.ok       ? await voiceRes.json()       : [];
  const textChannels  = textRes.ok        ? await textRes.json()        : [];
  const roles         = rolesRes.ok       ? await rolesRes.json()       : [];
  const categories    = categoriesRes.ok  ? await categoriesRes.json()  : [];

  document.getElementById('voiceWaitingChannel').innerHTML =
    '<option value="">Kein Warteraum ausgewählt</option>' +
    voiceChannels.map(c => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

  document.getElementById('voiceNotifyChannel').innerHTML =
    '<option value="">Kein Kanal ausgewählt</option>' +
    textChannels.map(c => `<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('');

  document.getElementById('voiceTeamRole').innerHTML =
    '<option value="">Keine</option>' +
    roles.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');

  document.getElementById('voiceTicketCategory').innerHTML =
    '<option value="">Nicht gesetzt</option>' +
    categories.map(c => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.emoji || '')} ${escapeHtml(c.name)}</option>`).join('');

  document.getElementById('restrictedRoleSelect').innerHTML =
    '<option value="">Keine – keine Einschränkung aktiv</option>' +
    roles.map(r => `<option value="${r.id}">${escapeHtml(r.name)}</option>`).join('');
}

async function loadRestrictedRole() {
  const res = await apiFetch('/api/admin/restricted-role');
  if (!res.ok) return;
  const data = await res.json();
  document.getElementById('restrictedRoleSelect').value = data.restricted_role_id || '';
}

async function saveRestrictedRole() {
  const alertEl = document.getElementById('restrictedRoleAlert');
  const payload = { restricted_role_id: document.getElementById('restrictedRoleSelect').value || null };

  alertEl.className   = 'alert alert-info';
  alertEl.textContent = 'Speichern…';
  try {
    const res  = await apiFetch('/api/admin/restricted-role', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) {
      alertEl.className   = 'alert alert-success';
      alertEl.textContent = '✓ Gespeichert';
    } else {
      alertEl.className   = 'alert alert-danger';
      alertEl.textContent = data.error || 'Fehler';
    }
  } catch {
    alertEl.className   = 'alert alert-danger';
    alertEl.textContent = 'Netzwerkfehler';
  }
}

function renderVoiceHoursRows(days) {
  const byWeekday = new Map((days || []).map(d => [d.weekday, d]));
  document.getElementById('voiceHoursRows').innerHTML = VOICE_WEEKDAY_ORDER.map(weekday => {
    const d = byWeekday.get(weekday) || { enabled: false, start_time: '', end_time: '' };
    return `
      <div class="row g-2 align-items-center mb-2 voice-hour-row" data-weekday="${weekday}">
        <div class="col-6 col-md-3">
          <div class="form-check form-switch mb-0">
            <input class="form-check-input voice-hour-enabled" type="checkbox" id="voiceHourEnabled-${weekday}" ${d.enabled ? 'checked' : ''} />
            <label class="form-check-label small" for="voiceHourEnabled-${weekday}">${VOICE_WEEKDAY_LABELS[weekday]}</label>
          </div>
        </div>
        <div class="col-3 col-md-3">
          <input type="time" class="form-control form-control-sm voice-hour-start" value="${escapeHtml(d.start_time || '')}" />
        </div>
        <div class="col-1 text-center text-muted small">bis</div>
        <div class="col-3 col-md-3">
          <input type="time" class="form-control form-control-sm voice-hour-end" value="${escapeHtml(d.end_time || '')}" />
        </div>
      </div>`;
  }).join('');
}

async function loadVoiceSupportSettings() {
  await loadVoiceSupportChannelOptions();
  await loadRestrictedRole();

  const res = await apiFetch('/api/admin/voice-support');
  if (!res.ok) return;
  const data = await res.json();

  document.getElementById('voiceWaitingChannel').value = data.waiting_channel_id || '';
  document.getElementById('voiceNotifyChannel').value  = data.notify_channel_id  || '';
  document.getElementById('voiceTeamRole').value       = data.staff_role_id     || '';
  document.getElementById('voiceManualOverride').value = data.manual_override   || '';
  document.getElementById('voiceTicketCategory').value = data.ticket_category   || '';
  document.getElementById('voiceTestMode').checked     = !!data.test_mode;
  document.getElementById('voiceTimezoneLabel').textContent = data.timezone || 'Europe/Vienna';

  const badge = document.getElementById('voiceStatusBadge');
  badge.textContent = data.test_mode ? '🧪 Testmodus' : (data.open ? '🟢 Offen' : '🔴 Geschlossen');
  badge.className   = `ticket-badge ${data.test_mode ? 'badge-load-yellow' : (data.open ? 'badge-load-green' : 'badge-load-red')}`;

  renderVoiceHoursRows(data.days);
}

async function saveVoiceSupportConfig() {
  const alertEl = document.getElementById('voiceConfigAlert');
  const payload = {
    waiting_channel_id: document.getElementById('voiceWaitingChannel').value || null,
    notify_channel_id:  document.getElementById('voiceNotifyChannel').value  || null,
    staff_role_id:      document.getElementById('voiceTeamRole').value       || null,
    manual_override:    document.getElementById('voiceManualOverride').value || null,
    ticket_category:    document.getElementById('voiceTicketCategory').value || null,
    test_mode:          document.getElementById('voiceTestMode').checked ? 1 : 0,
  };

  alertEl.className   = 'alert alert-info';
  alertEl.textContent = 'Speichern…';
  try {
    const res  = await apiFetch('/api/admin/voice-support', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) {
      alertEl.className   = 'alert alert-success';
      alertEl.textContent = '✓ Gespeichert';
      await loadVoiceSupportSettings();
    } else {
      alertEl.className   = 'alert alert-danger';
      alertEl.textContent = data.error || 'Fehler';
    }
  } catch {
    alertEl.className   = 'alert alert-danger';
    alertEl.textContent = 'Netzwerkfehler';
  }
}

function collectVoiceHours() {
  return Array.from(document.querySelectorAll('#voiceHoursRows .voice-hour-row')).map(row => ({
    weekday:    Number(row.dataset.weekday),
    enabled:    row.querySelector('.voice-hour-enabled').checked,
    start_time: row.querySelector('.voice-hour-start').value,
    end_time:   row.querySelector('.voice-hour-end').value,
  }));
}

async function saveVoiceSupportHours() {
  const alertEl = document.getElementById('voiceHoursAlert');
  const days = collectVoiceHours();

  if (days.some(d => d.enabled && (!d.start_time || !d.end_time))) {
    alertEl.className   = 'alert alert-danger';
    alertEl.textContent = 'Bitte für jeden aktivierten Tag Start- und Endzeit angeben.';
    return;
  }

  alertEl.className   = 'alert alert-info';
  alertEl.textContent = 'Speichern…';
  try {
    const res  = await apiFetch('/api/admin/voice-support/hours', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days }),
    });
    const data = await res.json();
    if (res.ok) {
      alertEl.className   = 'alert alert-success';
      alertEl.textContent = '✓ Gespeichert';
      await loadVoiceSupportSettings();
    } else {
      alertEl.className   = 'alert alert-danger';
      alertEl.textContent = data.error || 'Fehler';
    }
  } catch {
    alertEl.className   = 'alert alert-danger';
    alertEl.textContent = 'Netzwerkfehler';
  }
}

// ── Moderation (Log/Honeypot, Automod, Eskalationsleiter, Fallverlauf) ──────
const MOD_ACTION_LABELS = {
  warn: '⚠️ Warn', kick: '👢 Kick', ban: '🔨 Ban', tempban: '⏳ Tempban',
  unban: '🔓 Unban', timeout: '🔇 Timeout', untimeout: '🔊 Untimeout',
};

async function loadModerationChannelOptions() {
  const [channelsRes, rolesRes] = await Promise.all([
    apiFetch('/api/admin/moderation/channels'),
    apiFetch('/api/admin/guild-roles'),
  ]);
  const channels = channelsRes.ok ? await channelsRes.json() : [];
  const roles    = rolesRes.ok    ? await rolesRes.json()    : [];

  const optionsHtml = '<option value="">Kein Kanal ausgewählt</option>' +
    channels.map(c => `<option value="${c.id}">#${escapeHtml(c.name)}</option>`).join('');
  document.getElementById('modLogChannel').innerHTML = optionsHtml;
  document.getElementById('modHoneypotChannel').innerHTML = optionsHtml;

  document.getElementById('modExemptRoles').innerHTML = roles.length
    ? roles.map(r => `
        <div class="form-check">
          <input class="form-check-input mod-exempt-role-checkbox" type="checkbox" value="${r.id}" id="modExemptRole-${r.id}" />
          <label class="form-check-label small" for="modExemptRole-${r.id}">${escapeHtml(r.name)}</label>
        </div>`).join('')
    : '<p class="text-muted small mb-0">Keine Rollen gefunden.</p>';
}

function setExemptRoleCheckboxes(roleIds) {
  const set = new Set(roleIds || []);
  document.querySelectorAll('#modExemptRoles .mod-exempt-role-checkbox').forEach(cb => {
    cb.checked = set.has(cb.value);
  });
}

function collectExemptRoleIds() {
  return Array.from(document.querySelectorAll('#modExemptRoles .mod-exempt-role-checkbox:checked')).map(cb => cb.value);
}

function escalationRowHtml(rule) {
  rule = rule || { threshold: '', action: 'timeout', duration_minutes: 60 };
  return `
    <div class="row g-2 align-items-center mb-2 mod-escalation-row">
      <div class="col-auto">
        <label class="form-label text-muted small mb-0 d-block">Bei Warnungen</label>
        <input type="number" class="form-control form-control-sm mod-esc-threshold" min="1" style="width:100px" value="${rule.threshold}" />
      </div>
      <div class="col-auto">
        <label class="form-label text-muted small mb-0 d-block">Aktion</label>
        <select class="form-select form-select-sm mod-esc-action" style="width:140px" onchange="toggleEscalationDuration(this)">
          <option value="timeout" ${rule.action === 'timeout' ? 'selected' : ''}>Timeout</option>
          <option value="kick" ${rule.action === 'kick' ? 'selected' : ''}>Kick</option>
          <option value="ban" ${rule.action === 'ban' ? 'selected' : ''}>Ban</option>
        </select>
      </div>
      <div class="col-auto mod-esc-duration-wrap" ${rule.action !== 'timeout' ? 'style="display:none"' : ''}>
        <label class="form-label text-muted small mb-0 d-block">Dauer (Min.)</label>
        <input type="number" class="form-control form-control-sm mod-esc-duration" min="1" style="width:100px" value="${rule.duration_minutes || 60}" />
      </div>
      <div class="col-auto">
        <label class="form-label small mb-0 d-block">&nbsp;</label>
        <button type="button" class="btn btn-sm btn-outline-danger" onclick="this.closest('.mod-escalation-row').remove()">
          <i class="bi bi-x-lg"></i>
        </button>
      </div>
    </div>`;
}

function toggleEscalationDuration(selectEl) {
  const wrap = selectEl.closest('.mod-escalation-row').querySelector('.mod-esc-duration-wrap');
  wrap.style.display = selectEl.value === 'timeout' ? '' : 'none';
}

function addEscalationRow(rule) {
  document.getElementById('modEscalationRows').insertAdjacentHTML('beforeend', escalationRowHtml(rule));
}

function renderEscalationRows(rules) {
  const container = document.getElementById('modEscalationRows');
  container.innerHTML = '';
  (rules || []).forEach(r => addEscalationRow(r));
}

async function loadModerationSettings() {
  await loadModerationChannelOptions();

  const res = await apiFetch('/api/admin/moderation');
  if (!res.ok) return;
  const data = await res.json();

  document.getElementById('modLogChannel').value      = data.log_channel_id || '';
  document.getElementById('modHoneypotChannel').value = data.honeypot_channel_id || '';
  document.getElementById('modBannedWords').value      = (data.banned_words || []).join('\n');
  document.getElementById('modSpamEnabled').checked    = !!data.spam_enabled;
  document.getElementById('modSpamLimit').value        = data.spam_message_limit;
  document.getElementById('modSpamWindow').value       = data.spam_window_seconds;
  document.getElementById('modMentionEnabled').checked = !!data.mention_enabled;
  document.getElementById('modMentionLimit').value     = data.mention_limit;
  document.getElementById('modInviteEnabled').checked  = !!data.invite_block_enabled;
  document.getElementById('modEveryoneEnabled').checked = !!data.everyone_mention_enabled;
  setExemptRoleCheckboxes(data.exempt_role_ids);

  renderEscalationRows(data.escalation_rules);
  await Promise.all([loadModerationCases(), loadModerationMembers()]);
}

async function saveModerationConfig() {
  const alertEl = document.getElementById('modConfigAlert');
  const words = document.getElementById('modBannedWords').value
    .split('\n').map(w => w.trim()).filter(Boolean);

  const payload = {
    log_channel_id:       document.getElementById('modLogChannel').value || null,
    honeypot_channel_id:  document.getElementById('modHoneypotChannel').value || null,
    banned_words:         words,
    spam_enabled:         document.getElementById('modSpamEnabled').checked ? 1 : 0,
    spam_message_limit:   Number(document.getElementById('modSpamLimit').value) || 5,
    spam_window_seconds:  Number(document.getElementById('modSpamWindow').value) || 5,
    mention_enabled:      document.getElementById('modMentionEnabled').checked ? 1 : 0,
    mention_limit:        Number(document.getElementById('modMentionLimit').value) || 5,
    invite_block_enabled: document.getElementById('modInviteEnabled').checked ? 1 : 0,
    everyone_mention_enabled: document.getElementById('modEveryoneEnabled').checked ? 1 : 0,
    exempt_role_ids:      collectExemptRoleIds(),
  };

  alertEl.className   = 'alert alert-info';
  alertEl.textContent = 'Speichern…';
  try {
    const res  = await apiFetch('/api/admin/moderation', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (res.ok) {
      alertEl.className   = 'alert alert-success';
      alertEl.textContent = '✓ Gespeichert';
    } else {
      alertEl.className   = 'alert alert-danger';
      alertEl.textContent = data.error || 'Fehler';
    }
  } catch {
    alertEl.className   = 'alert alert-danger';
    alertEl.textContent = 'Netzwerkfehler';
  }
}

function collectEscalationRules() {
  return Array.from(document.querySelectorAll('#modEscalationRows .mod-escalation-row')).map(row => ({
    threshold:        Number(row.querySelector('.mod-esc-threshold').value),
    action:           row.querySelector('.mod-esc-action').value,
    duration_minutes: Number(row.querySelector('.mod-esc-duration').value) || null,
  }));
}

async function saveEscalationRules() {
  const alertEl = document.getElementById('modEscalationAlert');
  const rules = collectEscalationRules();

  if (rules.some(r => !r.threshold || r.threshold < 1)) {
    alertEl.className = 'alert alert-danger';
    alertEl.textContent = 'Bitte für jede Stufe eine gültige Warnanzahl (≥ 1) angeben.';
    return;
  }
  const thresholds = rules.map(r => r.threshold);
  if (new Set(thresholds).size !== thresholds.length) {
    alertEl.className = 'alert alert-danger';
    alertEl.textContent = 'Jede Warnanzahl darf nur einmal vorkommen.';
    return;
  }

  alertEl.className   = 'alert alert-info';
  alertEl.textContent = 'Speichern…';
  try {
    const res  = await apiFetch('/api/admin/moderation/escalation', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rules }),
    });
    const data = await res.json();
    if (res.ok) {
      alertEl.className   = 'alert alert-success';
      alertEl.textContent = '✓ Gespeichert';
    } else {
      alertEl.className   = 'alert alert-danger';
      alertEl.textContent = data.error || 'Fehler';
    }
  } catch {
    alertEl.className   = 'alert alert-danger';
    alertEl.textContent = 'Netzwerkfehler';
  }
}

async function loadModerationCases() {
  const tbody = document.getElementById('modCasesTableBody');
  const res = await apiFetch('/api/admin/moderation/cases');
  const cases = res.ok ? await res.json() : [];

  if (!cases.length) {
    tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted py-4">Noch keine Fälle.</td></tr>';
    return;
  }

  tbody.innerHTML = cases.map(c => `
    <tr class="${c.revoked ? 'text-muted' : ''}">
      <td>#${c.case_number}</td>
      <td>${MOD_ACTION_LABELS[c.action] || escapeHtml(c.action)}</td>
      <td>${escapeHtml(c.username)}</td>
      <td>${escapeHtml(c.moderator_name)}</td>
      <td>${escapeHtml(c.reason || '—')}</td>
      <td>${formatDate(c.created_at)}</td>
    </tr>`).join('');
}

function formatAge(days) {
  if (days == null) return '–';
  if (days < 1) return 'heute';
  if (days < 31) return `${days} Tag(e)`;
  if (days < 365) return `${Math.floor(days / 30)} Monat(e)`;
  return `${Math.floor(days / 365)} Jahr(e)`;
}

const RISK_BADGE_CLASSES = {
  low: 'badge-load-green', medium: 'badge-load-yellow', high: 'badge-load-red', critical: 'badge-load-violet',
};

function riskRowClass(tier) {
  return tier === 'critical' ? 'risk-row-critical' : '';
}

async function loadModerationMembers() {
  const tbody = document.getElementById('modMembersTableBody');
  const res = await apiFetch('/api/admin/moderation/members');
  const members = res.ok ? await res.json() : [];

  if (!members.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted py-4">Keine Mitglieder gefunden.</td></tr>';
    return;
  }

  const now = Date.now();
  tbody.innerHTML = members.map(m => {
    const accountAgeDays = Math.floor((now - new Date(m.account_created_at).getTime()) / 86400000);
    const joinAgeDays    = m.joined_at ? Math.floor((now - new Date(m.joined_at).getTime()) / 86400000) : null;
    const badgeClass = RISK_BADGE_CLASSES[m.risk_tier] || 'badge-load-green';
    return `
      <tr class="${riskRowClass(m.risk_tier)}">
        <td>${escapeHtml(m.username)}</td>
        <td>${m.message_count}</td>
        <td>${m.last_message_at ? formatDate(m.last_message_at) : '–'}</td>
        <td>${m.active_warns}</td>
        <td>${m.kicks}</td>
        <td>${m.bans}</td>
        <td>${formatAge(accountAgeDays)}</td>
        <td>${formatAge(joinAgeDays)}</td>
        <td><span class="ticket-badge ${badgeClass}">${m.risk_label} (${m.risk_score})</span></td>
      </tr>`;
  }).join('');
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  const ok = await loadUser();
  if (!ok) return;
  switchTab('categories');
})();
