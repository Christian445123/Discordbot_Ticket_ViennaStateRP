'use strict';

// Central place for everything that gets posted to a guild's configured
// moderation log channel — mirrors the ticket module's ticketLog.js so both
// features log consistently, just to a separate channel/setting.

const { EmbedBuilder } = require('discord.js');
const db     = require('./db');
const logger = require('../../utils/logger');

const COLORS = {
  warn: 0xFEE75C, timeout: 0xEB459E, untimeout: 0x57F287,
  kick: 0xED4245, ban: 0x992D22, unban: 0x57F287, automod: 0xE67E22,
};

async function getLogChannel(discordClient, guildId) {
  const settings = await db.getSettings(guildId);
  if (!settings?.log_channel_id) return null;
  const guild = discordClient.guilds.cache.get(guildId);
  return guild?.channels.cache.get(settings.log_channel_id) ?? null;
}

async function logCase(discordClient, guildId, { caseId, type, userTag, userId, moderatorTag, reason, points, durationMs }) {
  const logCh = await getLogChannel(discordClient, guildId);
  if (!logCh) return;

  const { formatDuration } = require('./duration');
  const embed = new EmbedBuilder()
    .setTitle(`🛡️ Fall #${caseId} — ${type}`)
    .setColor(COLORS[type] ?? 0x5865F2)
    .addFields(
      { name: 'Nutzer',     value: `${userTag} (${userId})`, inline: true },
      { name: 'Moderator',  value: moderatorTag,               inline: true },
      { name: 'Punkte',     value: `${points}`,                inline: true },
      ...(durationMs ? [{ name: 'Dauer', value: formatDuration(durationMs), inline: true }] : []),
      { name: 'Grund', value: reason || '(kein Grund angegeben)', inline: false },
    )
    .setTimestamp();

  await logCh.send({ embeds: [embed] })
    .catch(err => logger.error('Mod-Log fehlgeschlagen:', err.message));
}

async function logAppeal(discordClient, guildId, { caseId, appealId, userTag, message }) {
  const logCh = await getLogChannel(discordClient, guildId);
  if (!logCh) return null;

  const { ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
  const embed = new EmbedBuilder()
    .setTitle(`📨 Einspruch zu Fall #${caseId}`)
    .setColor(0x5865F2)
    .addFields(
      { name: 'Von',      value: userTag,   inline: true },
      { name: 'Nachricht', value: message.length > 1000 ? `${message.slice(0, 1000)}…` : message, inline: false },
    )
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`mod_appeal_accept_${appealId}`).setLabel('Annehmen').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`mod_appeal_reject_${appealId}`).setLabel('Ablehnen').setStyle(ButtonStyle.Danger),
  );

  return logCh.send({ embeds: [embed], components: [row] })
    .catch(err => { logger.error('Appeal-Log fehlgeschlagen:', err.message); return null; });
}

module.exports = { logCase, logAppeal };
