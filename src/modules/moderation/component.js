'use strict';

const db     = require('./db');
const guards = require('../../core/guards');

// Buttons/selects/modals owned by the moderation module: appeal
// accept/reject buttons posted alongside an appeal in the mod log channel
// (see modLog.js#logAppeal). Everything else is left alone.
async function component(interaction) {
  if (!interaction.isButton()) return;
  if (!interaction.customId.startsWith('mod_appeal_')) return;

  const isStaff = await guards.isStaff(interaction.client, interaction.guild.id, interaction.user.id);
  if (!isStaff) {
    return interaction.reply({ content: '❌ Nur Staff kann über Einsprüche entscheiden.', ephemeral: true });
  }

  const accept   = interaction.customId.startsWith('mod_appeal_accept_');
  const appealId = parseInt(interaction.customId.replace(accept ? 'mod_appeal_accept_' : 'mod_appeal_reject_', ''), 10);

  const appeal = await db.getAppealById(appealId);
  if (!appeal) return interaction.reply({ content: '❌ Einspruch nicht gefunden.', ephemeral: true });
  if (appeal.status !== 'pending') {
    return interaction.reply({ content: 'ℹ️ Über diesen Einspruch wurde bereits entschieden.', ephemeral: true });
  }

  const status = accept ? 'accepted' : 'rejected';
  await db.decideAppeal(appealId, status, interaction.user.id, null);
  await db.setAppealStatus(appeal.case_id, status);

  await interaction.update({
    content: `${accept ? '✅ Einspruch angenommen' : '❌ Einspruch abgelehnt'} von ${interaction.user.tag}.`,
    embeds: interaction.message.embeds,
    components: [],
  });
}

module.exports = { component };
