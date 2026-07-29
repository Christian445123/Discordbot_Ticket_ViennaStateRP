'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType } = require('discord.js');
const db                = require('../db');
const guards            = require('../../../core/guards');
const applicationService = require('../applicationService');

async function requireStaff(interaction) {
  const ok = await guards.isStaff(interaction.client, interaction.guild.id, interaction.user.id);
  if (!ok) await interaction.reply({ content: '❌ Nur Team-Leitung kann Bewerbungen einsehen/entscheiden.', ephemeral: true });
  return ok;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('bewerbung')
    .setDescription('Bewerbungen posten und bearbeiten')
    .addSubcommand(sub =>
      sub.setName('panel')
         .setDescription('Postet den "Jetzt bewerben"-Button für ein Formular (nur Admins)')
         .addStringOption(opt => opt.setName('formular').setDescription('Welches Formular').setRequired(true).setAutocomplete(true))
         .addChannelOption(opt => opt.setName('kanal').setDescription('Zielkanal (Standard: aktueller Kanal)').addChannelTypes(ChannelType.GuildText).setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('liste')
         .setDescription('Zeigt offene Bewerbungen (Team-Leitung)'))
    .addSubcommand(sub =>
      sub.setName('entscheiden')
         .setDescription('Nimmt eine Bewerbung an/lehnt sie ab (Team-Leitung)')
         .addIntegerOption(opt => opt.setName('id').setDescription('Bewerbungs-ID').setRequired(true))
         .addBooleanOption(opt => opt.setName('angenommen').setDescription('Annehmen? (false = ablehnen)').setRequired(true))
         .addStringOption(opt => opt.setName('notiz').setDescription('Interne Notiz').setRequired(false))),

  async autocomplete(interaction) {
    const focused = interaction.options.getFocused();
    const forms = await db.getForms(interaction.guild.id);
    const filtered = forms.filter(f => f.open && f.name.toLowerCase().includes(focused.toLowerCase())).slice(0, 25);
    await interaction.respond(filtered.map(f => ({ name: f.name, value: f.name })));
  },

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'panel') {
      const formName = interaction.options.getString('formular', true);
      const form = await db.getFormByName(guildId, formName);
      if (!form || !form.open) return interaction.reply({ content: '❌ Formular nicht gefunden oder geschlossen.', ephemeral: true });

      const channel = interaction.options.getChannel('kanal') ?? interaction.channel;
      const embed = new EmbedBuilder()
        .setTitle(`📋 Bewerbung: ${form.name}`)
        .setDescription('Klicke auf den Button, um dich zu bewerben.')
        .setColor(0x5865F2);
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId(`team_apply_${form.id}`).setLabel('Jetzt bewerben').setStyle(ButtonStyle.Primary).setEmoji('📋'),
      );

      await channel.send({ embeds: [embed], components: [row] });
      return interaction.reply({ content: `✅ Bewerbungs-Panel in ${channel} gepostet.`, ephemeral: true });
    }

    if (sub === 'liste') {
      if (!(await requireStaff(interaction))) return;
      const applications = await db.getPendingApplications(guildId);
      if (applications.length === 0) return interaction.reply({ content: 'Keine offenen Bewerbungen.', ephemeral: true });

      const lines = applications.slice(0, 20).map(a => `#${a.id} — <@${a.user_id}> — Formular: ${a.form_name}`);
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle('📋 Offene Bewerbungen').setDescription(lines.join('\n')).setColor(0x5865F2)], ephemeral: true });
    }

    if (sub === 'entscheiden') {
      if (!(await requireStaff(interaction))) return;
      const id         = interaction.options.getInteger('id', true);
      const angenommen = interaction.options.getBoolean('angenommen', true);
      const notiz       = interaction.options.getString('notiz');

      const result = await applicationService.decide(interaction.client, interaction.guild, id, angenommen, interaction.user.id, notiz);
      if (result.error) return interaction.reply({ content: `❌ ${result.error}`, ephemeral: true });

      return interaction.reply({ content: `✅ Bewerbung #${id} wurde ${angenommen ? 'angenommen' : 'abgelehnt'}.`, ephemeral: true });
    }
  },
};
