'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireStaff, recordAction } = require('../actions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kick')
    .setDescription('Kickt einen Nutzer vom Server (nur Staff)')
    .addUserOption(opt => opt.setName('user').setDescription('Wer wird gekickt').setRequired(true))
    .addStringOption(opt => opt.setName('grund').setDescription('Grund').setRequired(true))
    .addIntegerOption(opt => opt.setName('punkte').setDescription('Straf-Punkte (Standard: 3)').setRequired(false)),

  async execute(interaction) {
    if (!(await requireStaff(interaction))) return;

    const targetUser = interaction.options.getUser('user', true);
    const reason      = interaction.options.getString('grund', true);
    const points      = interaction.options.getInteger('punkte') ?? 3;

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Nutzer nicht auf diesem Server gefunden.', ephemeral: true });

    await targetUser.send(
      `👢 Du wurdest von **${interaction.guild.name}** gekickt.\nGrund: ${reason}`,
    ).catch(() => {});

    try {
      await member.kick(reason);
    } catch (err) {
      return interaction.reply({ content: `❌ Kick fehlgeschlagen: ${err.message}`, ephemeral: true });
    }

    const caseId = await recordAction(interaction, { type: 'kick', targetUser, reason, points });

    const embed = new EmbedBuilder()
      .setTitle('👢 Nutzer gekickt')
      .setColor(0xED4245)
      .addFields(
        { name: 'Fall',   value: `#${caseId}`, inline: true },
        { name: 'Nutzer', value: `${targetUser.tag}`, inline: true },
        { name: 'Grund',  value: reason, inline: false },
      );

    await interaction.reply({ embeds: [embed] });
  },
};
