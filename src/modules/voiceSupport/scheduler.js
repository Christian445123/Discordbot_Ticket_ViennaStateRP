'use strict';

// Keeps the waiting-room voice channel's name in sync with "are we
// currently open" (schedule AND NOT manually closed), both on a periodic
// timer and on-demand right after a relevant setting changes (setup
// command, web panel) so admins see the effect immediately instead of
// waiting up to a minute.

const db     = require('./db');
const hours  = require('./hours');
const logger = require('../../utils/logger');

const CHECK_INTERVAL_MS = 60_000;
const NAME_OPEN   = 'Supportwarteraum [offen]';
const NAME_CLOSED = 'Supportwarteraum [geschlossen]';

async function isOpen(guildId, cfg) {
  if (cfg?.manual_closed) return false;
  const rows = await db.getHours(guildId);
  return hours.isWithinSupportHours(rows);
}

// Renames the configured waiting-room channel to reflect the current
// open/closed state, if it doesn't already have the right name. Returns
// the resolved open state (or null if there's nothing configured/found),
// so callers can e.g. show it back in a command reply without a second
// lookup.
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
