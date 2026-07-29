'use strict';

// Cross-cutting permission checks shared by every module.

const { PermissionFlagsBits } = require('discord.js');
const licenseService = require('./license/licenseService');
const logger          = require('../utils/logger');

function isSuperAdmin(userId) {
  const ids = (process.env.SUPER_ADMIN_IDS || '').split(',').map(s => s.trim()).filter(Boolean);
  return ids.includes(userId);
}

async function requireLicenseSilent(guildId) {
  try {
    return await licenseService.isValid(guildId);
  } catch (err) {
    logger.error('Lizenzprüfung fehlgeschlagen:', err.message);
    return false;
  }
}

// "Is this member staff" is primarily the ticket module's settings table
// (one staff role per guild, configured via /setup) — moderation and team
// modules reuse it rather than introducing a second role concept. This is
// the one intentional core -> module dependency in the codebase.
//
// Real Discord Administrators always count as staff too, regardless of
// whether a staff role has been configured — otherwise a guild that never
// ran `/setup staff_rolle:@...` (or only wants it for tickets, not
// moderation/team) would lock EVERYONE, including its own owner, out of
// every staff-gated command.
async function isStaff(discordClient, guildId, userId) {
  if (isSuperAdmin(userId)) return true; // bot owner: full access everywhere, no exceptions

  try {
    const guild = discordClient.guilds.cache.get(guildId)
               ?? await discordClient.guilds.fetch(guildId).catch(() => null);
    if (!guild) return false;

    const member = guild.members.cache.get(userId)
                || await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;

    if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

    const ticketDb = require('../modules/tickets/db');
    const guildCfg = await ticketDb.getGuild(guildId);
    return Boolean(guildCfg?.staff_role_id && member.roles.cache.has(guildCfg.staff_role_id));
  } catch {
    return false;
  }
}

// Real Discord "Administrator" permission — used for actions the license
// slash commands also restrict to server admins (e.g. activating a key),
// as opposed to isStaff() which is the ticket module's configurable role.
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

module.exports = { isSuperAdmin, requireLicenseSilent, isStaff, isGuildAdmin };
