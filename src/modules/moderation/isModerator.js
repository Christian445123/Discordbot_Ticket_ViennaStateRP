'use strict';

const { PermissionFlagsBits } = require('discord.js');

// Shared by /mod (commands/mod.js) and the "Nachricht melden (DM)" message
// context menu command (commands/reportDm.js) — authorization against the
// web-panel-configured moderator_role_ids, same convention as
// isTicketStaff/voiceSupport's isStaffMember elsewhere in this bot
// (Administrator always counts).
function isModerator(member, cfg) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;

  let moderatorRoleIds;
  try { moderatorRoleIds = JSON.parse(cfg?.moderator_role_ids || '[]'); } catch { moderatorRoleIds = []; }
  return moderatorRoleIds.some(roleId => member.roles.cache.has(roleId));
}

module.exports = { isModerator };
