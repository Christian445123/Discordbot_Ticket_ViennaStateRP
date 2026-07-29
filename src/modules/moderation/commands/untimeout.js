'use strict';

const { SlashCommandBuilder } = require('discord.js');
const { requireStaff, recordAction } = require('../actions');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('untimeout')
    .setDescription('Hebt den Timeout eines Nutzers auf (nur Staff)')
    .addUserOption(opt => opt.setName('user').setDescription('Wessen Timeout aufgehoben wird').setRequired(true))
    .addStringOption(opt => opt.setName('grund').setDescription('Grund').setRequired(false)),

  async execute(interaction) {
    if (!(await requireStaff(interaction))) return;

    const targetUser = interaction.options.getUser('user', true);
    const reason      = interaction.options.getString('grund') ?? 'Kein Grund angegeben';

    const member = await interaction.guild.members.fetch(targetUser.id).catch(() => null);
    if (!member) return interaction.reply({ content: '❌ Nutzer nicht auf diesem Server gefunden.', ephemeral: true });

    try {
      await member.timeout(null, reason);
    } catch (err) {
      return interaction.reply({ content: `❌ Aufheben fehlgeschlagen: ${err.message}`, ephemeral: true });
    }

    await recordAction(interaction, { type: 'untimeout', targetUser, reason, points: 0 });

    await interaction.reply({ content: `✅ Timeout von ${targetUser} wurde aufgehoben.` });
  },
};
