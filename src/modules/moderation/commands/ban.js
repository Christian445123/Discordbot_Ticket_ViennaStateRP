'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireStaff, recordAction } = require('../actions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('ban')
    .setDescription('Bannt einen Nutzer vom Server (nur Staff)')
    .addUserOption(opt => opt.setName('user').setDescription('Wer wird gebannt').setRequired(true))
    .addStringOption(opt => opt.setName('grund').setDescription('Grund').setRequired(true))
    .addIntegerOption(opt => opt.setName('loeschen_tage').setDescription('Nachrichten der letzten N Tage löschen (0-7)').setRequired(false))
    .addIntegerOption(opt => opt.setName('punkte').setDescription('Straf-Punkte (Standard: 5)').setRequired(false)),

  async execute(interaction) {
    if (!(await requireStaff(interaction))) return;

    const targetUser  = interaction.options.getUser('user', true);
    const reason       = interaction.options.getString('grund', true);
    const loeschenTage = interaction.options.getInteger('loeschen_tage') ?? 0;
    const points       = interaction.options.getInteger('punkte') ?? 5;

    await targetUser.send(
      `🔨 Du wurdest von **${interaction.guild.name}** gebannt.\nGrund: ${reason}`,
    ).catch(() => {});

    try {
      await interaction.guild.members.ban(targetUser.id, {
        reason,
        deleteMessageSeconds: Math.min(Math.max(loeschenTage, 0), 7) * 86400,
      });
    } catch (err) {
      return interaction.reply({ content: `❌ Bann fehlgeschlagen: ${err.message}`, ephemeral: true });
    }

    const caseId = await recordAction(interaction, { type: 'ban', targetUser, reason, points });

    const embed = new EmbedBuilder()
      .setTitle('🔨 Nutzer gebannt')
      .setColor(0x992D22)
      .addFields(
        { name: 'Fall',   value: `#${caseId}`, inline: true },
        { name: 'Nutzer', value: `${targetUser.tag}`, inline: true },
        { name: 'Grund',  value: reason, inline: false },
      );

    await interaction.reply({ embeds: [embed] });
  },
};
