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

// "Is this member staff" is still owned by the ticket module's settings
// table (one staff role per guild, configured via /setup) — moderation and
// team modules reuse it rather than introducing a second role concept.
// This is the one intentional core -> module dependency in the codebase.
async function isStaff(discordClient, guildId, userId) {
  try {
    const ticketDb = require('../modules/tickets/db');
    const guildCfg = await ticketDb.getGuild(guildId);
    if (!guildCfg?.staff_role_id) return false;

    const guild = discordClient.guilds.cache.get(guildId)
               ?? await discordClient.guilds.fetch(guildId).catch(() => null);
    if (!guild) return false;

    const member = guild.members.cache.get(userId)
                || await guild.members.fetch(userId).catch(() => null);
    if (!member) return false;

    return member.roles.cache.has(guildCfg.staff_role_id);
  } catch {
    return false;
  }
}

// Real Discord "Administrator" permission — used for actions the license
// slash commands also restrict to server admins (e.g. activating a key),
// as opposed to isStaff() which is the ticket module's configurable role.
async function isGuildAdmin(discordClient, guildId, userId) {
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
