'use strict';

// Shared waiting-room logic used both by events/voiceStateUpdate.js (fires
// on a fresh join) and scheduler.js (fires on a timer tick / right after a
// config change) — a state transition from "closed" to "open" (schedule
// boundary, manual override flipped to "open") needs to notice someone
// who's ALREADY sitting in the room just as much as someone joining fresh.

const { EmbedBuilder, ButtonBuilder, ButtonStyle, ActionRowBuilder, PermissionFlagsBits } = require('discord.js');
const db      = require('./db');
const session = require('./session');
const hours   = require('./hours');
const logger  = require('../../utils/logger');

const CREATE_TICKET_BUTTON_ID = 'voice_support_create_ticket';

// Administrator always counts as staff (same convention as the ticket
// module's isTicketStaff), on top of whatever team_rolle was configured.
function isStaffMember(member, staffRoleId) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return !!(staffRoleId && member.roles.cache.has(staffRoleId));
}

function countWaitingNonStaff(channel, staffRoleId) {
  return channel.members.filter(m => !m.user.bot && !isStaffMember(m, staffRoleId)).size;
}

function staffAlreadyPresent(channel, staffRoleId, exceptMemberId) {
  return channel.members.some(m => m.id !== exceptMemberId && !m.user.bot && isStaffMember(m, staffRoleId));
}

async function sendWaitNotification(client, guildId, cfg, member, channel) {
  if (!cfg.notify_channel_id) return;
  const notifyChannel = client.channels.cache.get(cfg.notify_channel_id)
    ?? await client.channels.fetch(cfg.notify_channel_id).catch(() => null);
  if (!notifyChannel) return;

  const embed = new EmbedBuilder()
    .setTitle('🎧 Jemand wartet im Support-Warteraum')
    .setColor(0xFEE75C)
    .addFields(
      { name: 'Nutzer', value: `${member}`,  inline: true },
      { name: 'Kanal',  value: `${channel}`, inline: true },
    )
    .setTimestamp();

  const mention = cfg.staff_role_id ? `<@&${cfg.staff_role_id}>` : undefined;
  await notifyChannel.send({ content: mention, embeds: [embed] }).catch(err => {
    logger.error('Voice-Support: Benachrichtigung konnte nicht gesendet werden:', err.message);
  });
}

// Starts the hold-music session for whoever is already waiting, if nobody
// is being handled yet — called after ANY event that could flip the room
// from closed to open (schedule boundary, manual override, a config
// change), not just a fresh join, so an admin flipping "manuell öffnen"
// while someone's already sitting in the room reacts immediately instead
// of waiting for them to leave and rejoin.
async function startIfWaiting(client, guildId, cfg, channel) {
  if (session.getSession(guildId)) return;
  if (staffAlreadyPresent(channel, cfg.staff_role_id, null)) return;

  const waiting = channel.members.filter(m => !m.user.bot && !isStaffMember(m, cfg.staff_role_id));
  const first = waiting.first();
  if (!first) return;

  session.startSession(channel, first.id);
  const active = session.getSession(guildId);
  waiting.forEach(m => active?.waitingUserIds.add(m.id));

  await sendWaitNotification(client, guildId, cfg, first, channel);
}

// Posted in the waiting room's own chat (not a DM — that would need a
// guild to create a ticket in, which a DM interaction doesn't carry) when
// someone joins while support is closed: explains the support hours and
// offers a one-click ticket instead of waiting for nobody.
async function sendClosedNotice(guildId, cfg, member, channel) {
  const hourRows = await db.getHours(guildId);

  const embed = new EmbedBuilder()
    .setTitle('🔒 Support ist aktuell geschlossen')
    .setDescription('Gerade ist niemand aus dem Team im Support-Warteraum verfügbar. Du kannst stattdessen ein Ticket erstellen.')
    .setColor(0xED4245)
    .addFields({ name: `Supportzeiten (${hours.TIMEZONE})`, value: hours.formatWeeklySummary(hourRows) })
    .setTimestamp();

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(CREATE_TICKET_BUTTON_ID)
      .setLabel('Supportticket erstellen')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎫'),
  );

  await channel.send({ content: `${member}`, embeds: [embed], components: [row] }).catch(err => {
    logger.error('Voice-Support: "Geschlossen"-Hinweis konnte nicht gesendet werden:', err.message);
  });
}

module.exports = {
  CREATE_TICKET_BUTTON_ID,
  isStaffMember,
  countWaitingNonStaff,
  staffAlreadyPresent,
  sendWaitNotification,
  startIfWaiting,
  sendClosedNotice,
};
