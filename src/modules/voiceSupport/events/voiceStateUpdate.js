'use strict';

const { Events, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db        = require('../db');
const session   = require('../session');
const scheduler = require('../scheduler');
const logger    = require('../../../utils/logger');

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

// Watches the configured waiting-room voice channel: the bot joins and
// plays hold music for the first non-staff user to enter, notifies the
// team, and leaves again once either the room empties out or a staff
// member shows up in person to take over.
async function execute(oldState, newState) {
  const guildId = newState.guild.id;
  const cfg     = await db.getConfig(guildId);
  if (!cfg?.waiting_channel_id) return;

  const waitingChannelId  = cfg.waiting_channel_id;
  const joinedWaitingRoom = newState.channelId === waitingChannelId && oldState.channelId !== waitingChannelId;
  const leftWaitingRoom   = oldState.channelId === waitingChannelId && newState.channelId !== waitingChannelId;
  if (!joinedWaitingRoom && !leftWaitingRoom) return;

  const member = joinedWaitingRoom ? newState.member : oldState.member;
  if (!member || member.user.bot) return;

  if (joinedWaitingRoom) {
    const existing = session.getSession(guildId);

    if (isStaffMember(member, cfg.staff_role_id)) {
      // A staff member joining in person means the wait is over — stop the
      // hold music so it doesn't talk over the actual support conversation.
      if (existing) session.stopSession(guildId);
      return;
    }

    if (!existing) {
      // Staff already sitting in the waiting room (e.g. keeping an eye on
      // it) means this user is already being helped in person — no need
      // for hold music or a "someone is waiting" ping.
      if (staffAlreadyPresent(newState.channel, cfg.staff_role_id, member.id)) return;

      // Outside support hours (or manually closed via the web panel), the
      // channel itself already says "[geschlossen]" — no point joining with
      // hold music or paging a team that isn't working right now.
      const open = await scheduler.isOpen(guildId, cfg);
      if (!open) return;

      session.startSession(newState.channel, member.id);
      await sendWaitNotification(newState.client, guildId, cfg, member, newState.channel);
    } else {
      existing.waitingUserIds.add(member.id);
    }
    return;
  }

  // leftWaitingRoom
  const existing = session.getSession(guildId);
  if (!existing) return;
  existing.waitingUserIds.delete(member.id);

  const channel   = oldState.channel;
  const remaining = channel ? countWaitingNonStaff(channel, cfg.staff_role_id) : 0;
  if (remaining === 0) session.stopSession(guildId);
}

module.exports = { name: Events.VoiceStateUpdate, execute };
