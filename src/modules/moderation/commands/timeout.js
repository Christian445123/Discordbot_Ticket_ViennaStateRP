'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireStaff, recordAction } = require('../actions');
const { parseDuration, formatDuration } = require('../duration');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('timeout')
    .setDescription('Timeoutet einen Nutzer (nur Staff)')
    .addUserOption(opt => opt.setName('user').setDescription('Wer wird getimeoutet').setRequired(true))
    .addStringOption(opt => opt.setName('dauer').setDescription('z.B. 10m, 2h, 1d (max. 28d)').setRequired(true))
    .addStringOption(opt => opt.setName('grund').setDescription('Grund').setRequired(true))
    .addIntegerOption(opt => opt.setName('punkte').setDescription('Straf-Punkte (Standard: 2)').setRequired(false)),

  async execute(interaction) {
    if (!(await requireStaff(interaction))) return;

    const targetUser = interaction.options.getUser('user', true);
    const durationStr = interaction.options.getString('dauer', true);
    const reason      = interaction.options.getString('grund', true);
    const points      = interaction.options.getInteger('punkte') ?? 2;

    const durationMs = parseDuration(durationStr);
    if (!durationMs || durationMs > 28 * 24 * 60 * 60 * 1000) {
      return interaction.reply({ content: '❌ Ungültige Dauer. Format: 10m, 2h, 1d (max. 28d).', ephemeral: true });
    }

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Nutzer nicht auf diesem Server gefunden.', ephemeral: true });

    try {
      await member.timeout(durationMs, reason);
    } catch (err) {
      return interaction.reply({ content: `❌ Timeout fehlgeschlagen: ${err.message}`, ephemeral: true });
    }

    const caseId = await recordAction(interaction, { type: 'timeout', targetUser, reason, points, durationMs });

    await targetUser.send(
      `🔇 Du wurdest auf **${interaction.guild.name}** für ${formatDuration(durationMs)} getimeoutet.\nGrund: ${reason}`,
    ).catch(() => {});

    const embed = new EmbedBuilder()
      .setTitle('🔇 Timeout gesetzt')
      .setColor(0xEB459E)
      .addFields(
        { name: 'Fall',   value: `#${caseId}`, inline: true },
        { name: 'Nutzer', value: `${targetUser}`, inline: true },
        { name: 'Dauer',  value: formatDuration(durationMs), inline: true },
        { name: 'Grund',  value: reason, inline: false },
      );

    await interaction.reply({ embeds: [embed] });
  },
};
