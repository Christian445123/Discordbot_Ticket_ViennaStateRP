'use strict';

const ticketId = window.location.pathname.split('/').pop();
let currentUser = null;
let ticketData  = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('de-AT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

function avatarHtml(msg) {
  const initials = (msg.username || '?').charAt(0).toUpperCase();
  if (msg.avatar_url) {
    return `<img src="${escapeHtml(msg.avatar_url)}" alt="${escapeHtml(msg.username)}" onerror="this.style.display='none';this.parentNode.textContent='${initials}'" />`;
  }
  return initials;
}

// ── Load user info ────────────────────────────────────────────────────────────
async function loadUser() {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/'; return; }
  currentUser = await res.json();

  document.getElementById('userInfo').innerHTML = `
    <img src="${currentUser.avatar}" class="user-avatar" alt="${currentUser.username}" />
    <span class="fw-semibold">${escapeHtml(currentUser.username)}</span>
  `;
}

// ── Render ticket header ──────────────────────────────────────────────────────
function renderHeader(ticket) {
  document.title = `Ticket #${String(ticket.ticket_number).padStart(4, '0')} – Ticket-System`;

  document.getElementById('ticketTitle').textContent =
    `Ticket #${String(ticket.ticket_number).padStart(4, '0')} – ${ticket.subject || '(kein Betreff)'}`;

  const statusCls   = ticket.status === 'open' ? 'badge-open' : 'badge-closed';
  const statusLabel = ticket.status === 'open' ? 'Offen' : 'Geschlossen';
  const statusIcon  = ticket.status === 'open' ? 'bi-circle-fill' : 'bi-lock-fill';

  document.getElementById('ticketMeta').innerHTML = `
    <span class="meta-pill"><i class="bi bi-person-fill"></i>${escapeHtml(ticket.username)}</span>
    <span class="meta-pill"><i class="bi bi-tag-fill"></i>${escapeHtml(ticket.category)}</span>
    <span class="meta-pill"><i class="bi bi-clock-fill"></i>${formatDate(ticket.created_at)}</span>
    ${ticket.closed_at ? `<span class="meta-pill"><i class="bi bi-lock-fill"></i>Geschlossen: ${formatDate(ticket.closed_at)}</span>` : ''}
    <span class="ticket-badge ${statusCls} ms-1">
      <i class="bi ${statusIcon} me-1" style="font-size:.6rem"></i>${statusLabel}
    </span>
  `;

  // Show close button if open & user is owner or staff
  if (ticket.status === 'open') {
    const canClose = currentUser.isStaff || currentUser.id === ticket.user_id;
    if (canClose) document.getElementById('closeBtn').classList.remove('d-none');
  } else {
    document.getElementById('closedNotice').classList.remove('d-none');
  }
}

// ── Render messages ───────────────────────────────────────────────────────────
function renderMessages(messages) {
  const container = document.getElementById('messagesContainer');

  if (!messages.length) {
    container.innerHTML = '<p class="text-center text-muted py-4">Noch keine Nachrichten.</p>';
    return;
  }

  container.innerHTML = messages.map(m => {
    const isMe = currentUser && m.user_id === currentUser.id;
    const attachHtml = JSON.parse(m.attachments || '[]')
      .map(a => `<a href="${escapeHtml(a.url)}" target="_blank" rel="noopener noreferrer"
                    class="d-inline-block mt-1 me-1 text-accent small">
                   <i class="bi bi-paperclip me-1"></i>${escapeHtml(a.name)}
                 </a>`)
      .join('');

    return `
      <div class="message-group">
        <div class="msg-avatar">${avatarHtml(m)}</div>
        <div class="msg-body">
          <div class="msg-header">
            <span class="msg-author">${escapeHtml(m.username)}</span>
            <span class="msg-time">${formatDate(m.created_at)}</span>
          </div>
          ${m.content ? `<div class="msg-content ${isMe ? 'me' : ''}">${escapeHtml(m.content)}</div>` : ''}
          ${attachHtml}
        </div>
      </div>
    `;
  }).join('');

  container.scrollTop = container.scrollHeight;
}

// ── Close ticket ──────────────────────────────────────────────────────────────
async function closeTicket() {
  if (!confirm('Ticket wirklich schließen?')) return;

  const btn = document.getElementById('closeBtn');
  btn.disabled    = true;
  btn.textContent = 'Schließe…';

  try {
    const res = await fetch(`/api/tickets/${ticketId}/close`, { method: 'POST' });
    if (res.ok) {
      window.location.reload();
    } else {
      const err = await res.json();
      alert(`Fehler: ${err.error}`);
      btn.disabled    = false;
      btn.textContent = 'Ticket schließen';
    }
  } catch {
    alert('Netzwerkfehler');
    btn.disabled    = false;
    btn.textContent = 'Ticket schließen';
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  await loadUser();

  const res = await fetch(`/api/tickets/${ticketId}`);
  if (!res.ok) {
    document.getElementById('messagesContainer').innerHTML =
      '<div class="alert alert-danger">Ticket nicht gefunden oder kein Zugriff.</div>';
    return;
  }

  const data = await res.json();
  ticketData = data.ticket;

  renderHeader(ticketData);
  renderMessages(data.messages);
})();
