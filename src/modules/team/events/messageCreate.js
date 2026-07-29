'use strict';

const { Events } = require('discord.js');
const db     = require('../db');
const guards = require('../../../core/guards');

// A short-lived per-guild cache of team member IDs avoids a DB round trip
// for every single message from every non-team member (the common case).
const memberCache = new Map(); // guildId -> { ids: Set, fetchedAt }
const CACHE_TTL_MS = 60_000;

async function getTeamMemberIds(guildId) {
  const hit = memberCache.get(guildId);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) return hit.ids;
  const members = await db.getMembersByGuild(guildId);
  const ids = new Set(members.map(m => m.user_id));
  memberCache.set(guildId, { ids, fetchedAt: Date.now() });
  return ids;
}

module.exports = {
  name: Events.MessageCreate,

  async execute(message) {
    if (message.author.bot || !message.guild) return;
    if (!(await guards.requireLicenseSilent(message.guild.id))) return;

    const teamIds = await getTeamMemberIds(message.guild.id);
    if (!teamIds.has(message.author.id)) return;

    await db.touchActivity(message.guild.id, message.author.id);
  },
};
