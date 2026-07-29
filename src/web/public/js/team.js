'use strict';

let isStaff = true;

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatDate(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleDateString('de-AT');
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

function switchTab(tab) {
  for (const t of ['roster', 'applications', 'loa']) {
    document.getElementById(`tab-${t}`).classList.toggle('active', t === tab);
    document.getElementById(`pane-${t}`).classList.toggle('d-none', t !== tab);
  }
  if (tab === 'roster') loadRoster();
  if (tab === 'applications') loadApplications();
  if (tab === 'loa') loadLoa();
}

// ── Roster ────────────────────────────────────────────────────────────────────
async function loadRoster() {
  const container = document.getElementById('rosterCards');
  container.innerHTML = '<p class="text-muted small">Lade…</p>';
  const res = await apiFetch('/api/team/roster');
  if (!checkStaffResponse(res)) return;
  const members = await res.json();

  if (!members.length) { container.innerHTML = '<p class="text-muted small">Noch keine Teammitglieder erfasst.</p>'; return; }

  container.innerHTML = members.map(m => `
    <div class="col-md-6 col-lg-4">
      <div class="card bg-dark-card border-0 shadow-sm h-100">
        <div class="card-body">
          <div class="d-flex align-items-center justify-content-between mb-2">
            <span class="fw-semibold">${escapeHtml(m.rank_name)}</span>
            <button class="btn btn-sm btn-outline-warning" onclick="openWarnings('${m.user_id}')" title="Teamakte">
              <i class="bi bi-folder-fill"></i>
            </button>
          </div>
          <p class="text-muted small mb-0"><i class="bi bi-person me-1"></i>${m.user_id}</p>
          <p class="text-muted small mb-0"><i class="bi bi-calendar me-1"></i>seit ${formatDate(m.since)}</p>
        </div>
      </div>
    </div>
  `).join('');
}

async function openWarnings(userId) {
  document.getElementById('warningsModalTitle').innerHTML = `<i class="bi bi-folder-fill text-warning me-2"></i>Teamakte: ${userId}`;
  const listEl = document.getElementById('warningsList');
  listEl.innerHTML = '<p class="text-muted small">Lade…</p>';
  new bootstrap.Modal(document.getElementById('warningsModal')).show();

  const res = await apiFetch(`/api/team/warnings/${userId}`);
  if (!res.ok) { listEl.innerHTML = '<p class="text-danger small">Fehler beim Laden.</p>'; return; }
  const warnings = await res.json();
  if (!warnings.length) { listEl.innerHTML = '<p class="text-muted small">Keine Einträge.</p>'; return; }

  listEl.innerHTML = warnings.map(w => `
    <div class="note-card">
      <div class="note-author">von ${w.issued_by}</div>
      <div class="note-time">${formatDate(w.created_at)}</div>
      <div class="note-body">${escapeHtml(w.reason)}</div>
    </div>
  `).join('');
}

// ── Applications ──────────────────────────────────────────────────────────────
async function loadApplications() {
  const container = document.getElementById('applicationsList');
  container.innerHTML = '<p class="text-muted small">Lade…</p>';
  const res = await apiFetch('/api/team/applications');
  if (!checkStaffResponse(res)) return;
  const applications = await res.json();

  if (!applications.length) { container.innerHTML = '<p class="text-muted small">Keine offenen Bewerbungen.</p>'; return; }

  container.innerHTML = applications.map(a => `
    <div class="card bg-dark-card border-0 shadow-sm mb-2">
      <div class="card-body d-flex justify-content-between align-items-center">
        <div>
          <div class="fw-semibold">#${a.id} — ${escapeHtml(a.form_name)}</div>
          <div class="text-muted small">Bewerber: ${a.user_id} — ${formatDate(a.created_at)}</div>
        </div>
        <button class="btn btn-sm btn-primary" onclick="openDecide(${a.id})">Entscheiden</button>
      </div>
    </div>
  `).join('');
}

function openDecide(id) {
  document.getElementById('decideApplicationId').value = id;
  document.getElementById('decideNote').value = '';
  document.getElementById('decideAlert').className = 'alert d-none';
  new bootstrap.Modal(document.getElementById('decideModal')).show();
}

async function submitDecision(accepted) {
  const id   = document.getElementById('decideApplicationId').value;
  const note = document.getElementById('decideNote').value.trim();
  const alertEl = document.getElementById('decideAlert');
  try {
    const res  = await apiFetch(`/api/team/applications/${id}/decide`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accepted, note }),
    });
    const data = await res.json();
    if (res.ok) {
      await loadApplications();
      bootstrap.Modal.getInstance(document.getElementById('decideModal'))?.hide();
    } else {
      alertEl.className = 'alert alert-danger';
      alertEl.textContent = data.error || 'Fehler.';
    }
  } catch {
    alertEl.className = 'alert alert-danger';
    alertEl.textContent = 'Netzwerkfehler.';
  }
}

// ── LOA ───────────────────────────────────────────────────────────────────────
async function loadLoa() {
  const container = document.getElementById('loaList');
  container.innerHTML = '<p class="text-muted small">Lade…</p>';
  const res = await apiFetch('/api/team/loa');
  if (!checkStaffResponse(res)) return;
  const requests = await res.json();

  if (!requests.length) { container.innerHTML = '<p class="text-muted small">Keine Urlaubsanträge.</p>'; return; }

  const statusBadge = s => {
    const map = { pending: ['badge-cat-4','Ausstehend'], approved: ['badge-open','Genehmigt'], rejected: ['badge-closed','Abgelehnt'], ended: ['badge-cat-5','Beendet'] };
    const [cls, label] = map[s] ?? map.pending;
    return `<span class="ticket-badge ${cls}">${label}</span>`;
  };

  container.innerHTML = requests.map(r => `
    <div class="card bg-dark-card border-0 shadow-sm mb-2">
      <div class="card-body d-flex justify-content-between align-items-center flex-wrap gap-2">
        <div>
          <div class="fw-semibold">#${r.id} — ${r.user_id}</div>
          <div class="text-muted small">${formatDate(r.start_at)} – ${formatDate(r.end_at)}${r.reason ? ` — ${escapeHtml(r.reason)}` : ''}</div>
        </div>
        <div class="d-flex align-items-center gap-2">
          ${statusBadge(r.status)}
          ${r.status === 'pending' ? `
            <button class="btn btn-sm btn-success" onclick="decideLoa(${r.id}, true)">Genehmigen</button>
            <button class="btn btn-sm btn-danger" onclick="decideLoa(${r.id}, false)">Ablehnen</button>
          ` : ''}
        </div>
      </div>
    </div>
  `).join('');
}

async function decideLoa(id, approved) {
  await apiFetch(`/api/team/loa/${id}/decide`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ approved }),
  });
  loadLoa();
}

// ── Staff gate ────────────────────────────────────────────────────────────────
function checkStaffResponse(res) {
  if (res.status === 403) {
    isStaff = false;
    document.getElementById('notStaffHint').classList.remove('d-none');
    document.getElementById('teamContent').classList.add('d-none');
    return false;
  }
  if (res.ok) {
    document.getElementById('notStaffHint').classList.add('d-none');
    document.getElementById('teamContent').classList.remove('d-none');
  }
  return res.ok;
}

loadUser();
loadRoster();
