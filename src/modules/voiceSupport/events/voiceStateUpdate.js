'use strict';

const { Events } = require('discord.js');
const db        = require('../db');
const session   = require('../session');
const scheduler = require('../scheduler');
const waitRoom  = require('../waitRoom');

// Watches the configured waiting-room voice channel: while support is open
// (schedule, or a manual override — see scheduler.isOpen), the bot joins
// and plays hold music for the first non-staff user to enter and notifies
// the team; while closed, joiners instead get a "Support ist geschlossen"
// message with a one-click ticket button (see waitRoom.sendClosedNotice).
// Either way, the bot leaves again once the room empties out or a staff
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

    if (waitRoom.isStaffMember(member, cfg.staff_role_id)) {
      // A staff member joining in person means the wait is over — stop the
      // hold music so it doesn't talk over the actual support conversation.
      if (existing) session.stopSession(guildId);
      return;
    }

    if (existing) {
      existing.waitingUserIds.add(member.id);
      return;
    }

    const open = await scheduler.isOpen(guildId, cfg);
    if (!open) {
      await waitRoom.sendClosedNotice(guildId, cfg, member, newState.channel);
      return;
    }

    // Staff already sitting in the waiting room (e.g. keeping an eye on
    // it) means this user is already being helped in person — no need
    // for hold music or a "someone is waiting" ping.
    if (waitRoom.staffAlreadyPresent(newState.channel, cfg.staff_role_id, member.id)) return;

    session.startSession(newState.channel, member.id);
    await waitRoom.sendWaitNotification(newState.client, guildId, cfg, member, newState.channel);
    return;
  }

  // leftWaitingRoom
  const existing = session.getSession(guildId);
  if (!existing) return;
  existing.waitingUserIds.delete(member.id);

  const channel   = oldState.channel;
  const remaining = channel ? waitRoom.countWaitingNonStaff(channel, cfg.staff_role_id) : 0;
  if (remaining === 0) session.stopSession(guildId);
}

module.exports = { name: Events.VoiceStateUpdate, execute };
