'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { requireStaff } = require('../actions');
const db = require('../db');
const { formatDuration } = require('../duration');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('case')
    .setDescription('Moderations-Fälle ansehen oder kommentieren (nur Staff)')
    .addSubcommand(sub =>
      sub.setName('ansehen')
         .setDescription('Zeigt einen Fall im Detail')
         .addIntegerOption(opt => opt.setName('id').setDescription('Fall-ID').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('notiz')
         .setDescription('Fügt einem Fall eine interne Notiz hinzu')
         .addIntegerOption(opt => opt.setName('id').setDescription('Fall-ID').setRequired(true))
         .addStringOption(opt => opt.setName('text').setDescription('Notiztext').setRequired(true))),

  async execute(interaction) {
    if (!(await requireStaff(interaction))) return;

    const sub = interaction.options.getSubcommand();
    const id  = interaction.options.getInteger('id', true);
    const modCase = await db.getCaseById(id);

    if (!modCase || modCase.guild_id !== interaction.guild.id) {
      return interaction.reply({ content: '❌ Fall nicht gefunden.', ephemeral: true });
    }

    if (sub === 'ansehen') {
      const embed = new EmbedBuilder()
        .setTitle(`🛡️ Fall #${modCase.id} — ${modCase.type}`)
        .setColor(0x5865F2)
        .addFields(
          { name: 'Nutzer',    value: `<@${modCase.user_id}>`, inline: true },
          { name: 'Moderator', value: `<@${modCase.moderator_id}>`, inline: true },
          { name: 'Punkte',    value: `${modCase.points}`, inline: true },
          { name: 'Dauer',     value: modCase.duration_ms ? formatDuration(modCase.duration_ms) : '–', inline: true },
          { name: 'Einspruch', value: modCase.appeal_status, inline: true },
          { name: 'Erstellt',  value: new Date(modCase.created_at).toLocaleString('de-AT'), inline: true },
          { name: 'Grund',     value: modCase.reason || '–', inline: false },
          ...(modCase.note ? [{ name: 'Notiz', value: modCase.note, inline: false }] : []),
        );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'notiz') {
      const text = interaction.options.getString('text', true);
      await db.addCaseNote(id, text);
      return interaction.reply({ content: `✅ Notiz zu Fall #${id} gespeichert.`, ephemeral: true });
    }
  },
};
