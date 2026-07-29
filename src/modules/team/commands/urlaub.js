'use strict';

const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const db     = require('../db');
const guards = require('../../../core/guards');

// /urlaub mixes self-service ("beantragen", anyone can use it) with
// leadership review ("liste"/"entscheiden") — Discord's per-command default
// permissions can't distinguish subcommands, so the staff check happens at
// runtime for the review subcommands only.
async function requireStaff(interaction) {
  const ok = await guards.isStaff(interaction.client, interaction.guild.id, interaction.user.id);
  if (!ok) await interaction.reply({ content: '❌ Nur Team-Leitung kann Urlaubsanträge einsehen/entscheiden.', ephemeral: true });
  return ok;
}

function parseDate(str) {
  const date = new Date(`${str}T00:00:00Z`);
  return isNaN(date.getTime()) ? null : date;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('urlaub')
    .setDescription('Urlaub/Abwesenheit im Team verwalten')
    .addSubcommand(sub =>
      sub.setName('beantragen')
         .setDescription('Beantragt Urlaub/Abwesenheit')
         .addStringOption(opt => opt.setName('von').setDescription('Start-Datum (JJJJ-MM-TT)').setRequired(true))
         .addStringOption(opt => opt.setName('bis').setDescription('End-Datum (JJJJ-MM-TT)').setRequired(true))
         .addStringOption(opt => opt.setName('grund').setDescription('Grund').setRequired(false)))
    .addSubcommand(sub =>
      sub.setName('liste')
         .setDescription('Zeigt alle Urlaubsanträge (Team-Leitung)'))
    .addSubcommand(sub =>
      sub.setName('entscheiden')
         .setDescription('Genehmigt/lehnt einen Urlaubsantrag ab (Team-Leitung)')
         .addIntegerOption(opt => opt.setName('id').setDescription('Antrags-ID').setRequired(true))
         .addBooleanOption(opt => opt.setName('genehmigt').setDescription('Genehmigen? (false = ablehnen)').setRequired(true))),

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;

    if (sub === 'beantragen') {
      const startAt = parseDate(interaction.options.getString('von', true));
      const endAt   = parseDate(interaction.options.getString('bis', true));
      const reason  = interaction.options.getString('grund');

      if (!startAt || !endAt || endAt < startAt) {
        return interaction.reply({ content: '❌ Ungültiger Zeitraum. Format: JJJJ-MM-TT, Enddatum muss nach Startdatum liegen.', ephemeral: true });
      }

      const id = await db.createLoa({ guildId, userId: interaction.user.id, startAt, endAt, reason });
      return interaction.reply({ content: `✅ Urlaubsantrag #${id} eingereicht (${interaction.options.getString('von')} – ${interaction.options.getString('bis')}). Die Team-Leitung entscheidet mit \`/urlaub entscheiden\`.`, ephemeral: true });
    }

    if (sub === 'liste') {
      if (!(await requireStaff(interaction))) return;
      const requests = await db.getLoaByGuild(guildId);
      if (requests.length === 0) return interaction.reply({ content: 'Keine Urlaubsanträge vorhanden.', ephemeral: true });

      const lines = requests.slice(0, 20).map(r =>
        `#${r.id} — <@${r.user_id}> — ${new Date(r.start_at).toLocaleDateString('de-AT')} bis ${new Date(r.end_at).toLocaleDateString('de-AT')} — **${r.status}**${r.reason ? ` — ${r.reason}` : ''}`
      );
      return interaction.reply({ embeds: [new EmbedBuilder().setTitle('🏖️ Urlaubsanträge').setDescription(lines.join('\n')).setColor(0x5865F2)], ephemeral: true });
    }

    if (sub === 'entscheiden') {
      if (!(await requireStaff(interaction))) return;
      const id        = interaction.options.getInteger('id', true);
      const genehmigt = interaction.options.getBoolean('genehmigt', true);

      const request = await db.getLoaById(id);
      if (!request || request.guild_id !== guildId) return interaction.reply({ content: '❌ Antrag nicht gefunden.', ephemeral: true });

      await db.decideLoa(id, genehmigt ? 'approved' : 'rejected', interaction.user.id);
      return interaction.reply({ content: `✅ Antrag #${id} wurde ${genehmigt ? 'genehmigt' : 'abgelehnt'}.`, ephemeral: true });
    }
  },
};
