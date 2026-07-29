'use strict';

// Hourly housekeeping: auto-close expired LOA requests, and post an
// inactivity digest to each guild's configured team log channel (if any).
// Started once from events/ready.js once the client is logged in.

const { EmbedBuilder } = require('discord.js');
const db     = require('./db');
const guards = require('../../core/guards');
const logger = require('../../utils/logger');

const INTERVAL_MS = 60 * 60 * 1000;

async function runInactivityDigest(client) {
  for (const guild of client.guilds.cache.values()) {
    if (!(await guards.requireLicenseSilent(guild.id))) continue;

    const settings = await db.getTeamSettings(guild.id);
    if (!settings?.log_channel_id) continue;

    const thresholdMs = (settings.inactivity_days ?? 14) * 24 * 60 * 60 * 1000;
    const inactive = await db.getInactiveMembers(guild.id, thresholdMs);
    if (inactive.length === 0) continue;

    const channel = guild.channels.cache.get(settings.log_channel_id);
    if (!channel) continue;

    const lines = inactive.map(m =>
      `<@${m.user_id}> — ${m.rank_name} — ${m.last_active_at ? `zuletzt aktiv am ${new Date(m.last_active_at).toLocaleDateString('de-AT')}` : 'noch nie aktiv'}`
    );

    await channel.send({
      embeds: [new EmbedBuilder()
        .setTitle('😴 Inaktivitäts-Meldung')
        .setDescription(lines.join('\n'))
        .setColor(0xE67E22)
        .setFooter({ text: `Schwelle: ${settings.inactivity_days ?? 14} Tage ohne Nachricht` })],
    }).catch(err => logger.error('Inaktivitäts-Meldung fehlgeschlagen:', err.message));
  }
}

function start(client) {
  const tick = async () => {
    try {
      await db.endExpiredLoa();
      await runInactivityDigest(client);
    } catch (err) {
      logger.error('Team-Job fehlgeschlagen:', err.message);
    }
  };
  tick(); // run once at startup, then hourly
  setInterval(tick, INTERVAL_MS);
}

module.exports = { start };
