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
const ticketsDb = require('../tickets/db');
const logger  = require('../../utils/logger');

// The closed-notice is a DM, which has no guild context of its own — the
// guild is encoded right in the customId so the button handler
// (voiceSupport/component.js) knows which server's ticket system to use.
const CREATE_TICKET_BUTTON_PREFIX = 'voice_support_create_ticket_';

// Administrator always counts as staff (same convention as the ticket
// module's isTicketStaff), on top of whatever team_rolle was configured —
// UNLESS cfg.test_mode is on, which deliberately makes every staff/admin
// member look like a regular waiting user, so a team that only has staff
// accounts can still test the join/hold-music/notification flow on
// themselves instead of needing a second, non-staff Discord account.
function isStaffMember(member, cfg) {
  if (cfg?.test_mode) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  return !!(cfg?.staff_role_id && member.roles.cache.has(cfg.staff_role_id));
}

function countWaitingNonStaff(channel, cfg) {
  return channel.members.filter(m => !m.user.bot && !isStaffMember(m, cfg)).size;
}

function staffAlreadyPresent(channel, cfg, exceptMemberId) {
  return channel.members.some(m => m.id !== exceptMemberId && !m.user.bot && isStaffMember(m, cfg));
}

// The web-panel-configured restricted role (tickets guilds.restricted_role_id,
// see tickets/component.js's checkRestrictedRoleGate) is locked out of
// Voice-Support entirely — unconditionally, whether support is currently
// open or closed — not just rate-limited like the ticket side.
async function isRoleRestricted(guildId, member) {
  const ticketsCfg = await ticketsDb.getGuild(guildId);
  return !!(ticketsCfg?.restricted_role_id && member.roles.cache.has(ticketsCfg.restricted_role_id));
}

function buildTicketButtonRow(guildId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${CREATE_TICKET_BUTTON_PREFIX}${guildId}`)
      .setLabel('Supportticket erstellen')
      .setStyle(ButtonStyle.Primary)
      .setEmoji('🎫'),
  );
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
  if (staffAlreadyPresent(channel, cfg, null)) return;

  const waiting = channel.members.filter(m => !m.user.bot && !isStaffMember(m, cfg));
  const first = waiting.first();
  if (!first) return;

  session.startSession(channel, first.id);
  const active = session.getSession(guildId);
  waiting.forEach(m => active?.waitingUserIds.add(m.id));

  await sendWaitNotification(client, guildId, cfg, first, channel);
}

// Sent as a DM when someone joins the waiting room while support is
// closed: explains the support hours and offers a one-click ticket
// instead of waiting for nobody. Falls back to a mention in the waiting
// room's own chat if the DM can't be delivered (e.g. the user has direct
// messages from server members turned off), so they still get the info.
async function sendClosedNotice(guildId, cfg, member, channel) {
  const hourRows = await db.getHours(guildId);

  const embed = new EmbedBuilder()
    .setTitle('🔒 Support ist aktuell geschlossen')
    .setDescription('Gerade ist niemand aus dem Team im Support-Warteraum verfügbar. Du kannst stattdessen ein Ticket erstellen.')
    .setColor(0xED4245)
    .addFields({ name: `Supportzeiten (${hours.TIMEZONE})`, value: hours.formatWeeklySummary(hourRows) })
    .setTimestamp();

  const row = buildTicketButtonRow(guildId);

  try {
    await member.send({ embeds: [embed], components: [row] });
  } catch (err) {
    logger.warn(`Voice-Support: DM an ${member.user.tag} nicht zustellbar (${err.message}), weiche auf den Warteraum-Chat aus.`);
    await channel.send({ content: `${member}`, embeds: [embed], components: [row] }).catch(err2 => {
      logger.error('Voice-Support: "Geschlossen"-Hinweis konnte auch im Warteraum-Chat nicht gesendet werden:', err2.message);
    });
  }
}

// Sent as a DM when a restricted-role member joins the waiting room — no
// hold music, no notification, no staff-presence checks at all, since this
// role can't use Voice-Support regardless of open/closed status. Same
// ticket button as sendClosedNotice, since the restricted role's one
// permitted path is the same "Supportticket" category.
async function sendRestrictedNotice(guildId, member, channel) {
  const embed = new EmbedBuilder()
    .setTitle('🚫 Voice-Support nicht verfügbar')
    .setDescription('Mit deiner Rolle kannst du den Voice-Support nicht nutzen. Du kannst stattdessen ein Supportticket erstellen (1x pro Tag möglich).')
    .setColor(0xED4245)
    .setTimestamp();

  const row = buildTicketButtonRow(guildId);

  try {
    await member.send({ embeds: [embed], components: [row] });
  } catch (err) {
    logger.warn(`Voice-Support: DM an ${member.user.tag} nicht zustellbar (${err.message}), weiche auf den Warteraum-Chat aus.`);
    await channel.send({ content: `${member}`, embeds: [embed], components: [row] }).catch(err2 => {
      logger.error('Voice-Support: Einschränkungs-Hinweis konnte auch im Warteraum-Chat nicht gesendet werden:', err2.message);
    });
  }
}

module.exports = {
  CREATE_TICKET_BUTTON_PREFIX,
  isStaffMember,
  isRoleRestricted,
  countWaitingNonStaff,
  staffAlreadyPresent,
  sendWaitNotification,
  startIfWaiting,
  sendClosedNotice,
  sendRestrictedNotice,
};
