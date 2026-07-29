'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireStaff, recordAction } = require('../actions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('warn')
    .setDescription('Verwarnt einen Nutzer (nur Staff)')
    .addUserOption(opt => opt.setName('user').setDescription('Wer wird verwarnt').setRequired(true))
    .addStringOption(opt => opt.setName('grund').setDescription('Grund der Verwarnung').setRequired(true))
    .addIntegerOption(opt => opt.setName('punkte').setDescription('Straf-Punkte (Standard: 1)').setRequired(false)),

  async execute(interaction) {
    if (!(await requireStaff(interaction))) return;

    const targetUser = interaction.options.getUser('user', true);
    const reason      = interaction.options.getString('grund', true);
    const points      = interaction.options.getInteger('punkte') ?? 1;

    const caseId = await recordAction(interaction, { type: 'warn', targetUser, reason, points });

    await targetUser.send(
      `⚠️ Du wurdest auf **${interaction.guild.name}** verwarnt.\nGrund: ${reason}`,
    ).catch(() => {});

    const embed = new EmbedBuilder()
      .setTitle('⚠️ Verwarnung erteilt')
      .setColor(0xFEE75C)
      .addFields(
        { name: 'Fall',   value: `#${caseId}`, inline: true },
        { name: 'Nutzer', value: `${targetUser}`, inline: true },
        { name: 'Punkte', value: `${points}`, inline: true },
        { name: 'Grund',  value: reason, inline: false },
      );

    await interaction.reply({ embeds: [embed] });
  },
};
