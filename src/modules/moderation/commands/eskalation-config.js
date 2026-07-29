'use strict';

const { SlashCommandBuilder, EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const db = require('../db');
const { parseDuration, formatDuration } = require('../duration');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('eskalation-config')
    .setDescription('Automatische Eskalationsstufen konfigurieren (nur Admins)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('hinzufuegen')
         .setDescription('Fügt eine Eskalationsstufe hinzu')
         .addIntegerOption(opt => opt.setName('punkte_ab').setDescription('Ab wie vielen Punkten (30-Tage-Fenster)').setRequired(true))
         .addStringOption(opt => opt.setName('aktion').setDescription('Was passiert automatisch').setRequired(true)
           .addChoices(
             { name: 'Timeout', value: 'timeout' },
             { name: 'Kick',    value: 'kick' },
             { name: 'Bann',    value: 'ban' },
           ))
         .addStringOption(opt => opt.setName('dauer').setDescription('Nur bei Timeout, z.B. 1d').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('liste')
         .setDescription('Zeigt alle konfigurierten Eskalationsstufen')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'liste') {
      const rules = await db.getEscalationRules(guildId);
      if (rules.length === 0) return interaction.reply({ content: 'Noch keine Eskalationsstufen konfiguriert.', ephemeral: true });

      const lines = rules.map(r =>
        `Ab **${r.min_points} Punkten** → ${r.action}${r.duration_ms ? ` (${formatDuration(r.duration_ms)})` : ''}`
      );
      const embed = new EmbedBuilder().setTitle('📈 Eskalationsstufen').setDescription(lines.join('\n')).setColor(0x5865F2);
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const minPoints = interaction.options.getInteger('punkte_ab', true);
    const action    = interaction.options.getString('aktion', true);
    const dauerStr  = interaction.options.getString('dauer');

    let durationMs = null;
    if (action === 'timeout') {
      durationMs = parseDuration(dauerStr);
      if (!durationMs) return interaction.reply({ content: '❌ Für "Timeout" muss `dauer` gültig sein (z.B. 1d).', ephemeral: true });
    }

    await db.addEscalationRule(guildId, { minPoints, action, durationMs });
    return interaction.reply({ content: `✅ Eskalationsstufe gespeichert: ab ${minPoints} Punkten → ${action}.`, ephemeral: true });
  },
};
