'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bewerbung-config')
    .setDescription('Bewerbungsformulare verwalten (nur Admins)')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('formular-erstellen')
         .setDescription('Erstellt ein neues Bewerbungsformular (max. 5 Fragen — Discord-Modal-Limit)')
         .addStringOption(opt => opt.setName('name').setDescription('Name des Formulars').setRequired(true))
         .addStringOption(opt => opt.setName('frage1').setDescription('Frage 1').setRequired(true))
         .addStringOption(opt => opt.setName('frage2').setDescription('Frage 2').setRequired(false))
         .addStringOption(opt => opt.setName('frage3').setDescription('Frage 3').setRequired(false))
         .addStringOption(opt => opt.setName('frage4').setDescription('Frage 4').setRequired(false))
         .addStringOption(opt => opt.setName('frage5').setDescription('Frage 5').setRequired(false))
         .addStringOption(opt => opt.setName('ziel_rang').setDescription('Rang, der bei Annahme vergeben wird').setRequired(false).setAutocomplete(true)))
    .addSubcommand(sub =>
      sub.setName('schliessen')
         .setDescription('Schließt ein Formular (keine neuen Bewerbungen mehr)')
         .addStringOption(opt => opt.setName('name').setDescription('Formular').setRequired(true).setAutocomplete(true)))
    .addSubcommand(sub =>
      sub.setName('liste')
         .setDescription('Listet alle Bewerbungsformulare')),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused(true);
    if (focused.name === 'ziel_rang') {
      const ranks = await db.getRanks(interaction.guild.id);
      const filtered = ranks.filter(r => r.name.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered.map(r => ({ name: r.name, value: r.name })));
    }
    if (focused.name === 'name') {
      const forms = await db.getForms(interaction.guild.id);
      const filtered = forms.filter(f => f.name.toLowerCase().includes(focused.value.toLowerCase())).slice(0, 25);
      return interaction.respond(filtered.map(f => ({ name: f.name, value: f.name })));
    }
    return interaction.respond([]);
  },

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'formular-erstellen') {
      const name = interaction.options.getString('name', true);
      if (await db.getFormByName(guildId, name)) {
        return interaction.reply({ content: '❌ Es gibt bereits ein Formular mit diesem Namen.', ephemeral: true });
      }

      const questions = [1, 2, 3, 4, 5]
        .map(n => interaction.options.getString(`frage${n}`))
        .filter(Boolean);

      let targetRankId = null;
      const zielRang = interaction.options.getString('ziel_rang');
      if (zielRang) {
        const rank = await db.getRankByName(guildId, zielRang);
        if (!rank) return interaction.reply({ content: '❌ Unbekannter Zielrang.', ephemeral: true });
        targetRankId = rank.id;
      }

      await db.createForm(guildId, { name, questions, targetRankId });
      return interaction.reply({ content: `✅ Formular **${name}** mit ${questions.length} Frage(n) erstellt. Poste es mit \`/bewerbung panel\`.`, ephemeral: true });
    }

    if (sub === 'schliessen') {
      const name = interaction.options.getString('name', true);
      const form = await db.getFormByName(guildId, name);
      if (!form) return interaction.reply({ content: '❌ Formular nicht gefunden.', ephemeral: true });
      await db.setFormOpen(form.id, false);
      return interaction.reply({ content: `🔒 Formular **${name}** geschlossen.`, ephemeral: true });
    }

    if (sub === 'liste') {
      const forms = await db.getForms(guildId);
      if (forms.length === 0) return interaction.reply({ content: 'Noch keine Formulare vorhanden.', ephemeral: true });
      const lines = forms.map(f => `**${f.name}** — ${f.open ? '✅ offen' : '🔒 geschlossen'} — ${JSON.parse(f.questions).length} Frage(n)`);
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle('📋 Bewerbungsformulare').setDescription(lines.join('\n')).setColor(0x5865F2)], ephemeral: true });
    }
  },
};
