'use strict';

// Keeps the waiting-room voice channel's name in sync with "are we
// currently open" (manual_override, if set, always wins outright — see
// isOpen() — otherwise the weekly schedule decides), both on a periodic
// timer and on-demand right after a relevant setting changes (setup
// command, web panel) so admins see the effect immediately instead of
// waiting up to a minute. Also picks up anyone already waiting the moment
// the room flips open (see waitRoom.startIfWaiting).
//
// A manual override isn't meant to stick forever: isOpen() auto-clears it
// after ~30 minutes and falls back to the schedule, unless test_mode is on.

const db       = require('./db');
const hours    = require('./hours');
const waitRoom = require('./waitRoom');
const logger   = require('../../utils/logger');

const CHECK_INTERVAL_MS = 60_000;
const MANUAL_OVERRIDE_EXPIRY_MS = 30 * 60 * 1000;
const NAME_OPEN   = 'Supportwarteraum [offen]';
const NAME_CLOSED = 'Supportwarteraum [geschlossen]';

// manual_override is a tri-state: 'closed' or 'open' always decide it
// outright (manual always beats the schedule, in either direction); NULL
// (nothing set) falls through to the weekly schedule. A manual override
// expires on its own after ~30 minutes and falls back to the schedule,
// unless test_mode is on (staff testing shouldn't get interrupted mid-test).
async function isOpen(guildId, cfg) {
  if (cfg?.manual_override && !cfg.test_mode) {
    const setAt = cfg.manual_override_set_at ? new Date(cfg.manual_override_set_at).getTime() : null;
    if (setAt && Date.now() - setAt >= MANUAL_OVERRIDE_EXPIRY_MS) {
      logger.info(`Voice-Support: Manuelle Übersteuerung (Guild ${guildId}) nach 30 Minuten abgelaufen – zurück auf Supportzeiten.`);
      await db.updateConfig(guildId, { manual_override: null });
      cfg.manual_override = null;
      cfg.manual_override_set_at = null;
    }
  }
  if (cfg?.manual_override === 'closed') return false;
  if (cfg?.manual_override === 'open') return true;
  const rows = await db.getHours(guildId);
  return hours.isWithinSupportHours(rows);
}

// Renames the configured waiting-room channel to reflect the current
// open/closed state, if it doesn't already have the right name, and starts
// the hold-music session for anyone already waiting if the room just
// turned out to be open. Returns the resolved open state (or null if
// there's nothing configured/found), so callers can e.g. show it back in a
// command reply without a second lookup.
async function syncGuildChannelName(client, guildId, cfg = null) {
  cfg = cfg ?? await db.getConfig(guildId);
  if (!cfg?.waiting_channel_id) return null;

  const guild = client.guilds.cache.get(guildId);
  if (!guild) return null;

  const channel = await guild.channels.fetch(cfg.waiting_channel_id).catch(() => null);
  if (!channel) return null;

  const open = await isOpen(guildId, cfg);
  const desiredName = open ? NAME_OPEN : NAME_CLOSED;
  if (channel.name !== desiredName) {
    await channel.setName(desiredName).catch(err => {
      logger.error(`Voice-Support: Warteraum-Kanal (Guild ${guildId}) konnte nicht umbenannt werden:`, err.message);
    });
  }

  if (open) await waitRoom.startIfWaiting(client, guildId, cfg, channel);
  return open;
}

async function syncAllGuilds(client) {
  const configs = await db.getAllConfigs();
  for (const cfg of configs) {
    await syncGuildChannelName(client, cfg.guild_id, cfg);
  }
}

let intervalHandle = null;

function start(client) {
  if (intervalHandle) return;
  syncAllGuilds(client).catch(err => logger.error('Voice-Support: Initialer Zeitplan-Sync fehlgeschlagen:', err.message));
  intervalHandle = setInterval(() => {
    syncAllGuilds(client).catch(err => logger.error('Voice-Support: Zeitplan-Sync fehlgeschlagen:', err.message));
  }, CHECK_INTERVAL_MS);
}

module.exports = { start, syncGuildChannelName, isOpen };
