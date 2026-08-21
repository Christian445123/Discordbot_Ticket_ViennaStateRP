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

function renderHeader(ticket) {
  document.title = `Ticket #${String(ticket.ticket_number).padStart(4,'0')} – Admin`;
  document.getElementById('ticketTitle').textContent =
    `Ticket #${String(ticket.ticket_number).padStart(4,'0')} – ${ticket.subject || '(kein Betreff)'}`;

  const sCls   = ticket.status === 'open' ? 'badge-open'    : 'badge-closed';
  const sLabel = ticket.status === 'open' ? 'Offen'         : 'Geschlossen';
  const sIcon  = ticket.status === 'open' ? 'bi-circle-fill': 'bi-lock-fill';

  document.getElementById('ticketMeta').innerHTML = `
    <span class="meta-pill"><i class="bi bi-person-fill"></i>${escapeHtml(ticket.username)}</span>
    <span class="meta-pill"><i class="bi bi-tag-fill"></i>${escapeHtml(ticket.category)}</span>
    <span class="meta-pill"><i class="bi bi-clock-fill"></i>${formatDate(ticket.created_at)}</span>
    ${ticket.closed_at ? `<span class="meta-pill"><i class="bi bi-lock-fill"></i>Geschlossen: ${formatDate(ticket.closed_at)}</span>` : ''}
    <span class="ticket-badge ${sCls} ms-1">
      <i class="bi ${sIcon} me-1" style="font-size:.6rem"></i>${sLabel}
    </span>
  `;

  const tBtn = document.getElementById('transcriptBtn');
  tBtn.href = `/api/tickets/${ticketId}/transcript`;
  tBtn.classList.remove('d-none');
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
