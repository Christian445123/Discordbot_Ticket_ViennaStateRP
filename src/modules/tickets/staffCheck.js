'use strict';

// Shared "is this member allowed to act as staff on this ticket" check, used
// by the Claim/Nachfragen buttons (component.js) and the auto-claim-on-reply
// trigger (events/messageCreate.js). Broader than just guilds.staff_role_id:
// a category's configured ping role(s) are exactly the people expected to
// work that category's tickets, so they count as staff for it too.

const { PermissionFlagsBits } = require('discord.js');
const pingRoles = require('./pingRoles');

function isTicketStaff(member, guildCfg, categoryCfg) {
  if (member.permissions.has(PermissionFlagsBits.Administrator)) return true;
  if (guildCfg?.staff_role_id && member.roles.cache.has(guildCfg.staff_role_id)) return true;
  if (categoryCfg?.ping_type === 'role') {
    const roleIds = pingRoles.parseStoredPingRoleIds(categoryCfg.ping_role_ids);
    if (roleIds.some(id => member.roles.cache.has(id))) return true;
  }
  return false;
}

module.exports = { isTicketStaff };
