'use strict';

const ticketId = window.location.pathname.split('/').pop();
let currentUser = null;

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('de-AT', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}
function avatarHtml(msg) {
  const init = (msg.username || '?').charAt(0).toUpperCase();
  if (msg.avatar_url) {
    return `<img src="${escapeHtml(msg.avatar_url)}" class="msg-avatar-img"
              onerror="this.parentNode.textContent='${init}'" alt="" />`;
  }
  return init;
}

function switchTicketTab(tab) {
  ['messages', 'notes'].forEach(t => {
    document.getElementById(`pane-${t}`)?.classList.toggle('d-none', t !== tab);
    document.getElementById(`tab-${t}`)?.classList.toggle('active', t === tab);
  });
  if (tab === 'notes') loadNotes();
}

async function loadUser() {
  const res = await apiFetch('/api/me');
  if (!res.ok) { window.location.href = '/'; return; }
  currentUser = await res.json();
  document.getElementById('userInfo').innerHTML = `
    <img src="${currentUser.avatar}" class="user-avatar" alt="${escapeHtml(currentUser.username)}" />
    <span class="fw-semibold d-none d-md-inline">${escapeHtml(currentUser.username)}</span>
  `;
}

// "In Bearbeitung" isn't a stored status — it's status='open' with
// claimed_by_id set (see db.js/routes.js's POST /tickets/:id/claim).
function ticketDisplayStatus(ticket) {
  if (ticket.status === 'closed') return 'closed';
  return ticket.claimed_by_id ? 'in_progress' : 'open';
}

const STATUS_META = {
  open:        { cls: 'badge-open',     label: 'Offen',          icon: 'bi-circle-fill' },
  in_progress: { cls: 'badge-progress', label: 'In Bearbeitung', icon: 'bi-person-fill-gear' },
  closed:      { cls: 'badge-closed',   label: 'Geschlossen',    icon: 'bi-lock-fill' },
};

function renderHeader(ticket) {
  document.title = `Ticket #${String(ticket.ticket_number).padStart(3,'0')} – Admin`;
  document.getElementById('ticketTitle').textContent =
    `Ticket #${String(ticket.ticket_number).padStart(3,'0')} – ${ticket.subject || '(kein Betreff)'}`;

  const { cls: sCls, label: sLabel, icon: sIcon } = STATUS_META[ticketDisplayStatus(ticket)];

  document.getElementById('ticketMeta').innerHTML = `
    <span class="meta-pill"><i class="bi bi-person-fill"></i>${escapeHtml(ticket.username)}</span>
    <span class="meta-pill"><i class="bi bi-tag-fill"></i>${escapeHtml(ticket.category)}</span>
    <span class="meta-pill"><i class="bi bi-clock-fill"></i>${formatDate(ticket.created_at)}</span>
    ${ticket.closed_at ? `<span class="meta-pill"><i class="bi bi-lock-fill"></i>Geschlossen: ${formatDate(ticket.closed_at)}</span>` : ''}
    ${ticket.claimed_by_name ? `<span class="meta-pill"><i class="bi bi-hand-index-thumb-fill"></i>Übernommen von ${escapeHtml(ticket.claimed_by_name)}</span>` : ''}
    <span class="ticket-badge ${sCls} ms-1">
      <i class="bi ${sIcon} me-1" style="font-size:.6rem"></i>${sLabel}
    </span>
  `;

  const tBtn = document.getElementById('transcriptBtn');
  tBtn.href = `/api/tickets/${ticketId}/transcript`;
  tBtn.classList.remove('d-none');

  const claimBtn = document.getElementById('claimBtn');
  if (ticket.status === 'closed') {
    claimBtn.classList.add('d-none');
  } else {
    claimBtn.classList.remove('d-none');
    claimBtn.innerHTML = ticket.claimed_by_name
      ? `<i class="bi bi-hand-index-thumb-fill me-1"></i>Übernehmen (aktuell: ${escapeHtml(ticket.claimed_by_name)})`
      : `<i class="bi bi-hand-index-thumb-fill me-1"></i>Übernehmen`;
  }
}

async function claimTicket() {
  const claimBtn = document.getElementById('claimBtn');
  claimBtn.disabled = true;
  try {
    const res = await apiFetch(`/api/tickets/${ticketId}/claim`, { method: 'POST' });
    if (res.ok) {
      const refreshed = await apiFetch(`/api/tickets/${ticketId}`).then(r => r.json());
      renderHeader(refreshed.ticket);
    } else {
      const err = await res.json();
      alert(err.error || 'Fehler beim Übernehmen');
    }
  } catch {
    alert('Netzwerkfehler');
  }
  claimBtn.disabled = false;
}

function renderMessages(messages) {
  const container = document.getElementById('messagesContainer');
  if (!messages.length) {
    container.innerHTML = '<p class="text-center text-muted py-4">Noch keine Nachrichten.</p>';
    return;
  }
  container.innerHTML = messages.map(m => {
    const attachments = Array.isArray(m.attachments) ? m.attachments : [];
    const attHtml = attachments
      .map(a => `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener" class="d-inline-block mt-1 me-1 text-accent small">
                   <i class="bi bi-paperclip me-1"></i>${escapeHtml(a.name)}</a>`)
      .join('');
    return `
      <div class="message-group">
        <div class="msg-avatar">${avatarHtml(m)}</div>
        <div class="msg-body">
          <div class="msg-header">
            <span class="msg-author">${escapeHtml(m.username)}</span>
            <span class="msg-time">${formatDate(m.created_at)}</span>
          </div>
          ${m.content ? `<div class="msg-content">${escapeHtml(m.content)}</div>` : ''}
          ${attHtml}
        </div>
      </div>`;
  }).join('');
}

async function loadNotes() {
  const list = document.getElementById('notesList');
  list.innerHTML = '<p class="text-muted small">Lade Notizen…</p>';
  try {
    const notes = await apiFetch(`/api/tickets/${ticketId}/notes`).then(r => r.json());
    if (!notes.length) { list.innerHTML = '<p class="text-muted small">Noch keine Notizen.</p>'; return; }
    list.innerHTML = notes.map(n => `
      <div class="note-card">
        <div class="d-flex justify-content-between">
          <span class="note-author"><i class="bi bi-sticky-fill me-1"></i>${escapeHtml(n.username)}</span>
          <span class="note-time">${formatDate(n.created_at)}</span>
        </div>
        <div class="note-body">${escapeHtml(n.content)}</div>
      </div>`).join('');
  } catch {
    list.innerHTML = '<p class="text-danger small">Fehler beim Laden.</p>';
  }
}

async function addNote() {
  const input = document.getElementById('noteInput');
  const alertEl = document.getElementById('noteAlert');
  const content = input.value.trim();
  if (!content) return;

  alertEl.textContent = 'Speichern…';
  try {
    const res = await apiFetch(`/api/tickets/${ticketId}/notes`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content }),
    });
    if (res.ok) {
      input.value = '';
      alertEl.textContent = '✓ Gespeichert';
      setTimeout(() => { alertEl.textContent = ''; }, 2000);
      loadNotes();
    } else {
      const err = await res.json();
      alertEl.textContent = err.error || 'Fehler';
    }
  } catch { alertEl.textContent = 'Netzwerkfehler'; }
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  await loadUser();
  const res = await apiFetch(`/api/tickets/${ticketId}`);
  if (!res.ok) {
    document.getElementById('messagesContainer').innerHTML =
      '<div class="alert alert-danger">Ticket nicht gefunden oder kein Zugriff.</div>';
    return;
  }
  const data = await res.json();
  renderHeader(data.ticket);
  renderMessages(data.messages);
})();
