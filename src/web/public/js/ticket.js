'use strict';

const ticketId  = window.location.pathname.split('/').pop();
let categories  = []; // loaded from /api/categories
let currentUser = null;
let ticketData  = null;
let activeTab   = 'messages';
let lastMessageCount = -1;
let pollTimer   = null;

// ── Helpers ───────────────────────────────────────────────────────────────────
function escapeHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatDate(iso) {
  if (!iso) return '';
  return new Date(iso).toLocaleString('de-AT', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
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

// ── Tab switching ─────────────────────────────────────────────────────────────
function switchTicketTab(tab) {
  activeTab = tab;
  ['messages','transcript','notes'].forEach(t => {
    document.getElementById(`pane-${t}`)?.classList.toggle('d-none', t !== tab);
    document.getElementById(`tab-${t}`)?.classList.toggle('active',  t === tab);
  });
  if (tab === 'notes' && ticketData) loadNotes();
}

// ── Load user ─────────────────────────────────────────────────────────────────
async function loadUser() {
  const res = await fetch('/api/me');
  if (!res.ok) { window.location.href = '/'; return; }
  currentUser = await res.json();
  document.getElementById('userInfo').innerHTML = `
    <img src="${currentUser.avatar}" class="user-avatar" alt="${escapeHtml(currentUser.username)}" />
    <span class="fw-semibold d-none d-md-inline">${escapeHtml(currentUser.username)}</span>
  `;
}

// ── Render ticket header ──────────────────────────────────────────────────────
function renderHeader(ticket, isStaff) {
  document.title = `Ticket #${String(ticket.ticket_number).padStart(4,'0')} – Ticket-System`;
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

  // Transcript button always visible
  const tBtn = document.getElementById('transcriptBtn');
  tBtn.href = `/api/tickets/${ticketId}/transcript`;
  tBtn.classList.remove('d-none');

  // Transcript tab links
  const openBtn = document.getElementById('transcriptOpenBtn');
  const dlBtn   = document.getElementById('transcriptDownloadBtn');
  if (openBtn) openBtn.href = `/api/tickets/${ticketId}/transcript`;
  if (dlBtn)   { dlBtn.href = `/api/tickets/${ticketId}/transcript`; dlBtn.download = `transcript-${ticketId}.html`; }

  // Close button, composer & closed notice — re-evaluated on every render since
  // the ticket status can change mid-session (e.g. closed from Discord while
  // this page is open, picked up by polling).
  const isOpen    = ticket.status === 'open';
  const canManage = isStaff || currentUser.id === ticket.user_id;
  document.getElementById('closeBtn').classList.toggle('d-none', !(isOpen && canManage));
  document.getElementById('composerWrap').classList.toggle('d-none', !(isOpen && canManage));
  document.getElementById('closedNotice').classList.toggle('d-none', isOpen);

  // Category select — Staff only, editable while the ticket is open
  const catSelect = document.getElementById('categorySelect');
  catSelect.classList.toggle('d-none', !isStaff);
  if (isStaff) {
    catSelect.innerHTML = categories.map(c =>
      `<option value="${escapeHtml(c.name)}" ${c.name === ticket.category ? 'selected' : ''}>${c.emoji ? `${c.emoji} ` : ''}${escapeHtml(c.name)}</option>`
    ).join('');
    catSelect.disabled = !isOpen;
  }

  // Staff notes tab
  if (isStaff) {
    document.getElementById('tab-notes').classList.remove('d-none');
  }
}

// ── Render messages ───────────────────────────────────────────────────────────
function renderMessages(messages) {
  lastMessageCount = messages.length;
  const container = document.getElementById('messagesContainer');
  if (!messages.length) {
    container.innerHTML = '<p class="text-center text-muted py-4">Noch keine Nachrichten.</p>';
    return;
  }
  container.innerHTML = messages.map(m => {
    const isMe = currentUser && m.user_id === currentUser.id;
    const attHtml = JSON.parse(typeof m.attachments === 'string' ? m.attachments : JSON.stringify(m.attachments || []))
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
          ${m.content ? `<div class="msg-content ${isMe?'me':''}">${escapeHtml(m.content)}</div>` : ''}
          ${attHtml}
        </div>
      </div>`;
  }).join('');
  container.scrollTop = container.scrollHeight;
}

// ── Load & render notes ───────────────────────────────────────────────────────
async function loadNotes() {
  const list = document.getElementById('notesList');
  list.innerHTML = '<p class="text-muted small">Lade Notizen…</p>';
  try {
    const notes = await fetch(`/api/tickets/${ticketId}/notes`).then(r => r.json());
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
  const alert = document.getElementById('noteAlert');
  const content = input.value.trim();
  if (!content) return;

  alert.textContent = 'Speichern…';
  try {
    const res = await fetch(`/api/tickets/${ticketId}/notes`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content }),
    });
    if (res.ok) {
      input.value       = '';
      alert.textContent = '✓ Gespeichert';
      setTimeout(() => { alert.textContent = ''; }, 2000);
      loadNotes();
    } else {
      const err = await res.json();
      alert.textContent = err.error || 'Fehler';
    }
  } catch { alert.textContent = 'Netzwerkfehler'; }
}

// ── Send message / live updates ─────────────────────────────────────────────
async function refreshTicket() {
  try {
    const res = await fetch(`/api/tickets/${ticketId}`);
    if (!res.ok) return;
    const data = await res.json();
    const headerChanged = ticketData?.status !== data.ticket.status
      || ticketData?.category !== data.ticket.category;
    ticketData = data.ticket;
    if (headerChanged) renderHeader(data.ticket, data.isStaff);
    if (headerChanged || data.messages.length !== lastMessageCount) renderMessages(data.messages);
  } catch { /* ignore transient network errors while polling */ }
}

async function changeCategory(newCategory) {
  const select = document.getElementById('categorySelect');
  const previous = ticketData?.category;
  select.disabled = true;
  try {
    const res = await fetch(`/api/tickets/${ticketId}/category`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ category: newCategory }),
    });
    if (res.ok) {
      await refreshTicket();
    } else {
      const err = await res.json();
      alert(err.error || 'Fehler beim Ändern der Kategorie.');
      select.value = previous;
    }
  } catch {
    alert('Netzwerkfehler.');
    select.value = previous;
  } finally {
    select.disabled = ticketData?.status !== 'open';
  }
}

function autoResizeComposer() {
  const el = document.getElementById('composerInput');
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
}

async function sendMessage() {
  const input  = document.getElementById('composerInput');
  const alertEl = document.getElementById('composerAlert');
  const btn    = document.getElementById('composerSendBtn');
  const content = input.value.trim();
  alertEl.textContent = '';
  if (!content) return;

  btn.disabled = true;
  try {
    const res  = await fetch(`/api/tickets/${ticketId}/messages`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ content }),
    });
    const data = await res.json();
    if (res.ok) {
      input.value = '';
      autoResizeComposer();
      await refreshTicket();
    } else {
      alertEl.textContent = data.error || 'Fehler beim Senden.';
    }
  } catch {
    alertEl.textContent = 'Netzwerkfehler.';
  } finally {
    btn.disabled = false;
    input.focus();
  }
}

function startPolling() {
  stopPolling();
  pollTimer = setInterval(() => {
    if (document.hidden || activeTab !== 'messages' || ticketData?.status === 'closed') return;
    refreshTicket();
  }, 5000);
}
function stopPolling() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) stopPolling(); else startPolling();
});

// ── Close ticket ──────────────────────────────────────────────────────────────
async function closeTicket() {
  if (!confirm('Ticket wirklich schließen?')) return;
  const btn = document.getElementById('closeBtn');
  btn.disabled    = true;
  btn.textContent = 'Schließe…';
  try {
    const res = await fetch(`/api/tickets/${ticketId}/close`, { method: 'POST' });
    if (res.ok) { window.location.reload(); }
    else {
      const err = await res.json();
      alert(`Fehler: ${err.error}`);
      btn.disabled  = false;
      btn.innerHTML = '<i class="bi bi-lock-fill me-1"></i>Ticket schließen';
    }
  } catch {
    alert('Netzwerkfehler');
    btn.disabled  = false;
    btn.innerHTML = '<i class="bi bi-lock-fill me-1"></i>Ticket schließen';
  }
}

// ── Composer event listeners ────────────────────────────────────────────────
const composerInput = document.getElementById('composerInput');
composerInput?.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});
composerInput?.addEventListener('input', autoResizeComposer);

// ── Init ──────────────────────────────────────────────────────────────────────
(async () => {
  await loadUser();
  try { categories = await fetch('/api/categories').then(r => r.json()); } catch { categories = []; }
  const res = await fetch(`/api/tickets/${ticketId}`);
  if (!res.ok) {
    document.getElementById('messagesContainer').innerHTML =
      '<div class="alert alert-danger">Ticket nicht gefunden oder kein Zugriff.</div>';
    return;
  }
  const data = await res.json();
  ticketData = data.ticket;
  renderHeader(data.ticket, data.isStaff);
  renderMessages(data.messages);
  startPolling();
})();
