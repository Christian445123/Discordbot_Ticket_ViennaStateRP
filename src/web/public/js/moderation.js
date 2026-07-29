'use strict';

let cases = [];

function escapeHtml(str) {
  return String(str ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function formatDate(iso) {
  if (!iso) return '–';
  return new Date(iso).toLocaleString('de-AT', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}
function appealBadge(status) {
  const map = {
    none:     ['badge-cat-5', '–'],
    pending:  ['badge-cat-4', 'Ausstehend'],
    accepted: ['badge-open',  'Angenommen'],
    rejected: ['badge-closed', 'Abgelehnt'],
  };
  const [cls, label] = map[status] ?? map.none;
  return `<span class="ticket-badge ${cls}">${label}</span>`;
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

async function loadCases() {
  const tbody = document.getElementById('casesTableBody');
  const res = await apiFetch('/api/cases');
  if (!res.ok) {
    tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4">Fehler beim Laden.</td></tr>`;
    return;
  }
  cases = await res.json();
  renderTable();
}

function renderTable() {
  const tbody = document.getElementById('casesTableBody');
  const empty = document.getElementById('emptyHint');
  if (!cases.length) { tbody.innerHTML = ''; empty.classList.remove('d-none'); return; }
  empty.classList.add('d-none');

  tbody.innerHTML = cases.map(c => `
    <tr>
      <td class="text-muted fw-mono">#${c.id}</td>
      <td><span class="ticket-badge badge-cat-1">${escapeHtml(c.type)}</span></td>
      <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(c.reason || '–')}</td>
      <td>${c.points}</td>
      <td class="text-muted small">${formatDate(c.created_at)}</td>
      <td>${appealBadge(c.appeal_status)}</td>
      <td class="text-end">
        ${c.appeal_status === 'none'
          ? `<button class="btn btn-sm btn-outline-primary" onclick="openAppeal(${c.id})">Einspruch</button>`
          : ''}
      </td>
    </tr>
  `).join('');
}

function openAppeal(caseId) {
  document.getElementById('appealCaseId').value = caseId;
  document.getElementById('appealMessage').value = '';
  document.getElementById('appealAlert').className = 'alert d-none';
  new bootstrap.Modal(document.getElementById('appealModal')).show();
}

async function submitAppeal() {
  const caseId  = document.getElementById('appealCaseId').value;
  const message = document.getElementById('appealMessage').value.trim();
  const alertEl = document.getElementById('appealAlert');
  if (!message) { alertEl.className = 'alert alert-danger'; alertEl.textContent = 'Bitte eine Begründung angeben.'; return; }

  const btn = document.getElementById('appealSubmitBtn');
  btn.disabled = true;
  try {
    const res  = await apiFetch(`/api/cases/${caseId}/appeal`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }),
    });
    const data = await res.json();
    if (res.ok) {
      alertEl.className = 'alert alert-success';
      alertEl.textContent = '✓ Einspruch eingereicht.';
      await loadCases();
      setTimeout(() => bootstrap.Modal.getInstance(document.getElementById('appealModal'))?.hide(), 800);
    } else {
      alertEl.className = 'alert alert-danger';
      alertEl.textContent = data.error || 'Fehler beim Senden.';
    }
  } catch {
    alertEl.className = 'alert alert-danger';
    alertEl.textContent = 'Netzwerkfehler.';
  } finally {
    btn.disabled = false;
  }
}

loadUser();
loadCases();
