'use strict';

// Shared by every admin page. Most deployments only ever have one guild, in
// which case this quietly does nothing — the server already falls back to
// DISCORD_GUILD_ID when no ?guild= param is present.

const GUILD_STORAGE_KEY = 'selectedGuildId';

function getSelectedGuildId() {
  return localStorage.getItem(GUILD_STORAGE_KEY) || '';
}

function setSelectedGuildId(id) {
  if (id) localStorage.setItem(GUILD_STORAGE_KEY, id);
  else localStorage.removeItem(GUILD_STORAGE_KEY);
}

// Wraps fetch() so every /api/... call carries the currently selected guild.
function apiFetch(path, options) {
  const guildId = getSelectedGuildId();
  if (guildId && path.startsWith('/api/')) {
    const sep = path.includes('?') ? '&' : '?';
    path = `${path}${sep}guild=${encodeURIComponent(guildId)}`;
  }
  return fetch(path, options);
}

async function initGuildSwitcher(containerId) {
  const container = document.getElementById(containerId);
  if (!container) return;
  try {
    const res = await fetch('/api/guilds');
    if (!res.ok) return;
    const guilds = await res.json();
    if (guilds.length <= 1) return; // nothing to switch between

    if (!getSelectedGuildId() || !guilds.some(g => g.id === getSelectedGuildId())) {
      setSelectedGuildId(guilds[0].id);
    }
    const current = getSelectedGuildId();

    const select = document.createElement('select');
    select.className = 'form-select form-select-sm';
    select.style.maxWidth = '200px';
    select.innerHTML = guilds.map(g =>
      `<option value="${g.id}" ${g.id === current ? 'selected' : ''}>${g.name}</option>`,
    ).join('');
    select.addEventListener('change', () => {
      setSelectedGuildId(select.value);
      window.location.reload();
    });
    container.appendChild(select);
  } catch { /* ignore — single-guild deployments never hit this */ }
}

document.addEventListener('DOMContentLoaded', () => {
  initGuildSwitcher('guildSwitcher');
});
