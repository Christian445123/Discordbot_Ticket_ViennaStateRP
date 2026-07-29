'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { requireStaff } = require('../actions');
const db = require('../db');
const modLog = require('../modLog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('unban')
    .setDescription('Entbannt einen Nutzer (nur Staff)')
    .addStringOption(opt => opt.setName('user_id').setDescription('Discord-User-ID').setRequired(true))
    .addStringOption(opt => opt.setName('grund').setDescription('Grund').setRequired(false)),

  async execute(interaction) {
    if (!(await requireStaff(interaction))) return;

    const userId = interaction.options.getString('user_id', true).trim();
    const reason  = interaction.options.getString('grund') ?? 'Kein Grund angegeben';

    try {
      await interaction.guild.members.unban(userId, reason);
    } catch (err) {
      return interaction.reply({ content: `❌ Entbannen fehlgeschlagen: ${err.message}`, ephemeral: true });
    }

    const caseId = await db.createCase({
      guildId: interaction.guild.id, userId, moderatorId: interaction.user.id,
      type: 'unban', reason, points: 0,
    });

    await modLog.logCase(interaction.client, interaction.guild.id, {
      caseId, type: 'unban', userTag: userId, userId,
      moderatorTag: interaction.user.tag, reason, points: 0,
    });

    await interaction.reply({ content: `✅ Nutzer \`${userId}\` wurde entbannt.` });
  },
};
