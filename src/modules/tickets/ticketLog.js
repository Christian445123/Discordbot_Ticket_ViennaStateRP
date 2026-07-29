'use strict';

// Central place for everything that gets posted to a guild's configured
// log channel, so Discord-side and Web-side actions stay in sync.

const { EmbedBuilder } = require('discord.js');
const db     = require('../database/db');
const logger = require('../utils/logger');

async function getLogChannel(discordClient, guildId) {
  const guildCfg = await db.getGuild(guildId);
  if (!guildCfg?.log_channel_id) return null;
  const guild = discordClient.guilds.cache.get(guildId);
  return guild?.channels.cache.get(guildCfg.log_channel_id) ?? null;
}

async function logTicketCreated(discordClient, guildId, { channel, username, category, source }) {
  const logCh = await getLogChannel(discordClient, guildId);
  if (!logCh) return;

  const embed = new EmbedBuilder()
    .setTitle('📋 Ticket erstellt')
    .setColor(0x57F287)
    .addFields(
      { name: 'Ticket',    value: `${channel}`, inline: true },
      { name: 'Benutzer',  value: username,      inline: true },
      { name: 'Kategorie', value: category,      inline: true },
      { name: 'Quelle',    value: source,        inline: true },
    )
    .setTimestamp();

  await logCh.send({ embeds: [embed] })
    .catch(err => logger.error('Log-Kanal (Ticket erstellt) fehlgeschlagen:', err.message));
}

async function logTicketClosed(discordClient, guildId, { ticket, closedByTag, source }) {
  const logCh = await getLogChannel(discordClient, guildId);
  if (!logCh) return;

  const messages = await db.getMessages(ticket.id);
  const transcript = messages
    .map(m => `[${m.created_at}] ${m.username}: ${m.content}`)
    .join('\n') || '(keine Nachrichten)';

  const embed = new EmbedBuilder()
    .setTitle('📋 Ticket geschlossen')
    .setColor(0xED4245)
    .addFields(
      { name: 'Ticket-Nr.',      value: `#${String(ticket.ticket_number).padStart(4, '0')}`, inline: true },
      { name: 'Erstellt von',    value: `<@${ticket.user_id}>`,                               inline: true },
      { name: 'Geschlossen von', value: closedByTag,                                          inline: true },
      { name: 'Nachrichten',     value: `${messages.length}`,                                 inline: true },
      { name: 'Quelle',          value: source,                                                inline: true },
    )
    .setTimestamp();

  await logCh.send({
    embeds: [embed],
    files: [{ attachment: Buffer.from(transcript, 'utf-8'), name: `transcript-${ticket.id}.txt` }],
  }).catch(err => logger.error('Log-Kanal (Ticket geschlossen) fehlgeschlagen:', err.message));
}

async function logNoteAdded(discordClient, guildId, { ticket, authorTag, content }) {
  const logCh = await getLogChannel(discordClient, guildId);
  if (!logCh) return;

  const embed = new EmbedBuilder()
    .setTitle('📝 Notiz hinzugefügt')
    .setColor(0x5865F2)
    .addFields(
      { name: 'Ticket-Nr.', value: `#${String(ticket.ticket_number).padStart(4, '0')}`, inline: true },
      { name: 'Von',        value: authorTag,                                            inline: true },
      { name: 'Notiz',      value: content.length > 500 ? `${content.slice(0, 500)}…` : content, inline: false },
    )
    .setTimestamp();

  await logCh.send({ embeds: [embed] })
    .catch(err => logger.error('Log-Kanal (Notiz) fehlgeschlagen:', err.message));
}

async function logCategoryChanged(discordClient, guildId, { ticket, oldCategory, newCategory, changedByTag }) {
  const logCh = await getLogChannel(discordClient, guildId);
  if (!logCh) return;

  const embed = new EmbedBuilder()
    .setTitle('🏷️ Kategorie geändert')
    .setColor(0x5865F2)
    .addFields(
      { name: 'Ticket-Nr.',   value: `#${String(ticket.ticket_number).padStart(4, '0')}`, inline: true },
      { name: 'Von',          value: oldCategory,                                          inline: true },
      { name: 'Zu',           value: newCategory,                                          inline: true },
      { name: 'Geändert von', value: changedByTag,                                         inline: true },
    )
    .setTimestamp();

  await logCh.send({ embeds: [embed] })
    .catch(err => logger.error('Log-Kanal (Kategorie geändert) fehlgeschlagen:', err.message));
}

async function logCategoryConfigChanged(discordClient, guildId, { action, name, changedByTag }) {
  const logCh = await getLogChannel(discordClient, guildId);
  if (!logCh) return;

  const embed = new EmbedBuilder()
    .setTitle('🏷️ Kategorie-Konfiguration geändert')
    .setColor(0x5865F2)
    .setDescription(`Kategorie **${name}** wurde ${action}.`)
    .setFooter({ text: `Von ${changedByTag}` })
    .setTimestamp();

  await logCh.send({ embeds: [embed] })
    .catch(err => logger.error('Log-Kanal (Kategorie-Konfiguration) fehlgeschlagen:', err.message));
}

module.exports = {
  logTicketCreated, logTicketClosed, logNoteAdded, logCategoryChanged, logCategoryConfigChanged,
};
