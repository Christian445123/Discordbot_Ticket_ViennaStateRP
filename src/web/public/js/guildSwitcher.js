'use strict';

// Shared by every dashboard page. Most deployments only ever have one
// licensed guild, in which case this quietly does nothing — the server
// already falls back to DISCORD_GUILD_ID when no ?guild= param is present.

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

// Shows a dismissible banner on every page (except /lizenz itself) when the
// current guild has no valid license, so staff notice before wondering why
// tickets/moderation/team API calls are failing with 403s.
async function initLicenseBanner() {
  if (window.location.pathname === '/lizenz') return;
  try {
    const res = await apiFetch('/api/license/status');
    if (!res.ok) return;
    const data = await res.json();
    if (data.activated && data.valid) return;

    const banner = document.createElement('div');
    banner.className = 'alert alert-warning rounded-0 mb-0 text-center small py-2';
    banner.innerHTML = `⚠️ Keine gültige Lizenz für diesen Server. <a href="/lizenz" class="alert-link">Jetzt aktivieren</a>.`;
    document.body.prepend(banner);
  } catch { /* ignore */ }
}

document.addEventListener('DOMContentLoaded', () => {
  initGuildSwitcher('guildSwitcher');
  initLicenseBanner();
});
