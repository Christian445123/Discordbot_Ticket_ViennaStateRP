'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireStaff } = require('../actions');
const db = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('modlogs')
    .setDescription('Zeigt den Moderations-Verlauf eines Nutzers (nur Staff)')
    .addUserOption(opt => opt.setName('user').setDescription('Welcher Nutzer').setRequired(true)),

  async execute(interaction) {
    if (!(await requireStaff(interaction))) return;

    const targetUser = interaction.options.getUser('user', true);
    const cases = await db.getCasesByUser(interaction.guild.id, targetUser.id);

    if (cases.length === 0) {
      return interaction.reply({ content: `Keine Einträge für ${targetUser.tag}.`, ephemeral: true });
    }

    const points = await db.getRecentPoints(interaction.guild.id, targetUser.id);
    const lines = cases.slice(0, 15).map(c =>
      `#${c.id} — **${c.type}** (${c.points} Pkt.) — ${new Date(c.created_at).toLocaleDateString('de-AT')} — ${c.reason || '–'}`
    );

    const embed = new EmbedBuilder()
      .setTitle(`🛡️ Verlauf: ${targetUser.tag}`)
      .setColor(0x5865F2)
      .setDescription(lines.join('\n'))
      .setFooter({ text: `${points} Punkte in den letzten 30 Tagen — ${cases.length} Einträge gesamt` });

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
