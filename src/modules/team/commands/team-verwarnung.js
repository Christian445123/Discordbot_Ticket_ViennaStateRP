'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('team-verwarnung')
    .setDescription('Interne Team-Verwarnungen (Teamakte) — nur Team-Leitung')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand(sub =>
      sub.setName('erstellen')
         .setDescription('Trägt eine interne Verwarnung in die Teamakte ein')
         .addUserOption(opt => opt.setName('user').setDescription('Welches Teammitglied').setRequired(true))
         .addStringOption(opt => opt.setName('grund').setDescription('Grund').setRequired(true)))
    .addSubcommand(sub =>
      sub.setName('liste')
         .setDescription('Zeigt die Teamakte eines Mitglieds')
         .addUserOption(opt => opt.setName('user').setDescription('Welches Teammitglied').setRequired(true))),

  async execute(interaction) {
    const sub        = interaction.options.getSubcommand();
    const targetUser = interaction.options.getUser('user', true);
    const guildId    = interaction.guild.id;

    if (sub === 'erstellen') {
      const reason = interaction.options.getString('grund', true);
      await db.addWarning(guildId, targetUser.id, interaction.user.id, reason);
      return interaction.reply({ content: `✅ Interne Verwarnung für ${targetUser} eingetragen.`, ephemeral: true });
    }

    if (sub === 'liste') {
      const warnings = await db.getWarnings(guildId, targetUser.id);
      if (warnings.length === 0) return interaction.reply({ content: `Keine Einträge in der Teamakte von ${targetUser.tag}.`, ephemeral: true });

      const lines = warnings.map(w => `${new Date(w.created_at).toLocaleDateString('de-AT')} — <@${w.issued_by}>: ${w.reason}`);
      return interaction.reply({
        embeds: [new EmbedBuilder().setTitle(`📁 Teamakte: ${targetUser.tag}`).setDescription(lines.join('\n')).setColor(0xED4245)],
        ephemeral: true,
      });
    }
  },
};
