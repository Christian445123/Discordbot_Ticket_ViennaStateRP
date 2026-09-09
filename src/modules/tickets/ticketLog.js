'use strict';

// Central place for everything that gets posted to a guild's configured log
// channel — AND, since this bot can serve many guilds, mirrored to one of
// two bot-wide webhooks (see .env.example): DISCORD_TICKET_LOG_WEBHOOK_URL
// for everything tied to a specific ticket (created/closed/claimed/category
// changed/notes), DISCORD_LOG_WEBHOOK_URL for system/config-level events
// (deploy/restart, category configuration changes). Either/both env vars
// can be left unset — dispatch() just skips a missing destination.

const { EmbedBuilder } = require('discord.js');
const db     = require('./db');
const logger = require('../../utils/logger');
const { sendToWebhook } = require('../../utils/discordWebhook');

const TICKET_WEBHOOK = 'DISCORD_TICKET_LOG_WEBHOOK_URL';
const SYSTEM_WEBHOOK = 'DISCORD_LOG_WEBHOOK_URL';

async function getLogChannel(discordClient, guildId) {
  const guildCfg = await db.getGuild(guildId);
  if (!guildCfg?.log_channel_id) return null;
  const guild = discordClient.guilds.cache.get(guildId);
  return guild?.channels.cache.get(guildCfg.log_channel_id) ?? null;
}

// Sends the same payload to the guild's own configured log channel (if any)
// and to a bot-wide webhook (if configured) — a global destination the bot
// owner sees across every guild, independent of each guild's own channel.
async function dispatch(discordClient, guildId, webhookEnvVar, payload) {
  await Promise.all([
    sendToWebhook(webhookEnvVar, payload),
    (async () => {
      const logCh = await getLogChannel(discordClient, guildId);
      if (!logCh) return;
      await logCh.send(payload).catch(err => logger.error('Log-Kanal fehlgeschlagen:', err.message));
    })(),
  ]);
}

// Ticket numbers are sequential per category (see component.js), so two
// tickets in different categories can share the same number — always pair
// the number with its category, e.g. "Bewerbung #007", never a bare "#007".
function formatTicketRef(ticket) {
  return `${ticket.category} #${String(ticket.ticket_number).padStart(3, '0')}`;
}

// The ticket webhook mixes events from every guild the bot is in, so every
// embed there needs to say which guild it's from — a per-guild log channel
// doesn't need that (it's already guild-scoped by definition), but showing
// it there too is harmless and keeps a single shared embed-building path.
function guildName(discordClient, guildId) {
  return discordClient.guilds.cache.get(guildId)?.name ?? guildId;
}

async function logTicketCreated(discordClient, guildId, { channel, username, category, source }) {
  const embed = new EmbedBuilder()
    .setTitle('📋 Ticket erstellt')
    .setColor(0x57F287)
    .addFields(
      { name: 'Server',    value: guildName(discordClient, guildId), inline: true },
      { name: 'Ticket',    value: `${channel}`, inline: true },
      { name: 'Benutzer',  value: username,      inline: true },
      { name: 'Kategorie', value: category,      inline: true },
      { name: 'Quelle',    value: source,        inline: true },
    )
    .setTimestamp();

  await dispatch(discordClient, guildId, TICKET_WEBHOOK, { embeds: [embed] });
}

async function logTicketClosed(discordClient, guildId, { ticket, closedByTag, source }) {
  const messages = await db.getMessages(ticket.id);
  const transcript = messages
    .map(m => `[${m.created_at}] ${m.username}: ${m.content}`)
    .join('\n') || '(keine Nachrichten)';

  const embed = new EmbedBuilder()
    .setTitle('📋 Ticket geschlossen')
    .setColor(0xED4245)
    .addFields(
      { name: 'Server',          value: guildName(discordClient, guildId),    inline: true },
      { name: 'Ticket-Nr.',      value: formatTicketRef(ticket),              inline: true },
      { name: 'Erstellt von',    value: `<@${ticket.user_id}>`,               inline: true },
      { name: 'Geschlossen von', value: closedByTag,                          inline: true },
      { name: 'Nachrichten',     value: `${messages.length}`,                 inline: true },
      { name: 'Quelle',          value: source,                               inline: true },
    )
    .setTimestamp();

  await dispatch(discordClient, guildId, TICKET_WEBHOOK, {
    embeds: [embed],
    files: [{ attachment: Buffer.from(transcript, 'utf-8'), name: `transcript-${ticket.id}.txt` }],
  });
}

async function logNoteAdded(discordClient, guildId, { ticket, authorTag, content }) {
  const embed = new EmbedBuilder()
    .setTitle('📝 Notiz hinzugefügt')
    .setColor(0x5865F2)
    .addFields(
      { name: 'Server',     value: guildName(discordClient, guildId), inline: true },
      { name: 'Ticket-Nr.', value: formatTicketRef(ticket),           inline: true },
      { name: 'Von',        value: authorTag,                         inline: true },
      { name: 'Notiz',      value: content.length > 500 ? `${content.slice(0, 500)}…` : content, inline: false },
    )
    .setTimestamp();

  await dispatch(discordClient, guildId, TICKET_WEBHOOK, { embeds: [embed] });
}

async function logTicketClaimed(discordClient, guildId, { ticket, claimedByTag, source }) {
  const embed = new EmbedBuilder()
    .setTitle('🖐️ Ticket übernommen')
    .setColor(0xFEE75C)
    .addFields(
      { name: 'Server',         value: guildName(discordClient, guildId), inline: true },
      { name: 'Ticket-Nr.',     value: formatTicketRef(ticket),           inline: true },
      { name: 'Übernommen von', value: claimedByTag,                      inline: true },
      { name: 'Quelle',         value: source || '🎮 Discord',            inline: true },
    )
    .setTimestamp();

  await dispatch(discordClient, guildId, TICKET_WEBHOOK, { embeds: [embed] });
}

async function logTicketHoldChanged(discordClient, guildId, { ticket, changedByTag, onHold, source }) {
  const embed = new EmbedBuilder()
    .setTitle(onHold ? '⏸️ Warte auf Rückmeldung gesetzt' : '▶️ Warte-Status aufgehoben')
    .setColor(onHold ? 0xE67E22 : 0x5865F2)
    .addFields(
      { name: 'Server',     value: guildName(discordClient, guildId), inline: true },
      { name: 'Ticket-Nr.', value: formatTicketRef(ticket),           inline: true },
      { name: 'Von',        value: changedByTag,                      inline: true },
      { name: 'Quelle',     value: source || '🎮 Discord',            inline: true },
    )
    .setTimestamp();

  await dispatch(discordClient, guildId, TICKET_WEBHOOK, { embeds: [embed] });
}

async function logCategoryChanged(discordClient, guildId, { ticket, oldCategory, newCategory, changedByTag }) {
  const embed = new EmbedBuilder()
    .setTitle('🏷️ Kategorie geändert')
    .setColor(0x5865F2)
    .addFields(
      { name: 'Server',       value: guildName(discordClient, guildId), inline: true },
      { name: 'Ticket-Nr.',   value: formatTicketRef(ticket),           inline: true },
      { name: 'Von',          value: oldCategory,                       inline: true },
      { name: 'Zu',           value: newCategory,                       inline: true },
      { name: 'Geändert von', value: changedByTag,                      inline: true },
    )
    .setTimestamp();

  await dispatch(discordClient, guildId, TICKET_WEBHOOK, { embeds: [embed] });
}

async function logCategoryConfigChanged(discordClient, guildId, { action, name, changedByTag }) {
  const embed = new EmbedBuilder()
    .setTitle('🏷️ Kategorie-Konfiguration geändert')
    .setColor(0x5865F2)
    .setDescription(`Kategorie **${name}** wurde ${action}.`)
    .addFields({ name: 'Server', value: guildName(discordClient, guildId), inline: true })
    .setFooter({ text: `Von ${changedByTag}` })
    .setTimestamp();

  await dispatch(discordClient, guildId, SYSTEM_WEBHOOK, { embeds: [embed] });
}

// Bot-wide actions (deploy/restart) triggered from the web panel — same
// shape as the sibling Discordbot_Follower project's webpanel _notify().
// Posted to whichever guild's log channel the admin had selected when
// triggering it, plus the global system webhook — best-effort visibility,
// not an audit trail (see the server-side logger.warn call at the call site
// for that).
async function logSystemAction(discordClient, guildId, { title, description, color, triggeredByTag }) {
  const embed = new EmbedBuilder()
    .setTitle(title)
    .setColor(color)
    .setDescription(description || null)
    .addFields({ name: 'Von', value: `${triggeredByTag}` })
    .setTimestamp();

  await dispatch(discordClient, guildId, SYSTEM_WEBHOOK, { embeds: [embed] });
}

module.exports = {
  logTicketCreated, logTicketClosed, logNoteAdded, logTicketClaimed, logTicketHoldChanged,
  logCategoryChanged, logCategoryConfigChanged, logSystemAction,
};
