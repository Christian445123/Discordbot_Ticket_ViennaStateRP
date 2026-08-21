'use strict';

// Cross-cutting permission checks shared by every module.

const { PermissionFlagsBits } = require('discord.js');

function isSuperAdmin(userId) {
  const ids = (process.env.SUPER_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  return ids.includes(userId);
}

// Real Discord "Administrator" permission — used to gate the entire admin
// web interface (categories/auto-messages/ticket overview) to server
// administrators only.
async function isGuildAdmin(discordClient, guildId, userId) {
  if (isSuperAdmin(userId)) return true; // bot owner: full access everywhere, no exceptions

  try {
    const guild = discordClient.guilds.cache.get(guildId)
               ?? await discordClient.guilds.fetch(guildId).catch(() => null);
    if (!guild) return false;

    const member = guild.members.cache.get(userId)
                || await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;

    return member.permissions.has(PermissionFlagsBits.Administrator);
  } catch {
    return false;
  }
}

module.exports = { isSuperAdmin, isGuildAdmin };
