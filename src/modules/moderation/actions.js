'use strict';

// Shared bits every moderation command needs: the staff-only gate, and
// "create a case + log it + check escalation" in one call.

const db         = require('./db');
const modLog     = require('./modLog');
const escalation = require('./escalation');
const guards     = require('../../core/guards');

async function requireStaff(interaction) {
  const ok = await guards.isStaff(interaction.client, interaction.guild.id, interaction.user.id);
  if (!ok) await interaction.reply({ content: '❌ Nur Staff kann diesen Befehl nutzen.', ephemeral: true });
  return ok;
}

async function recordAction(interaction, { type, targetUser, reason, points = 0, durationMs = null }) {
  const caseId = await db.createCase({
    guildId:     interaction.guild.id,
    userId:      targetUser.id,
    moderatorId: interaction.user.id,
    type, reason, points, durationMs,
  });

  await modLog.logCase(interaction.client, interaction.guild.id, {
    caseId, type, userTag: targetUser.tag, userId: targetUser.id,
    moderatorTag: interaction.user.tag, reason, points, durationMs,
  });

  if (points > 0) {
    await escalation.checkAndApply(interaction.client, interaction.guild, targetUser.id, points);
  }

  return caseId;
}

module.exports = { requireStaff, recordAction };
