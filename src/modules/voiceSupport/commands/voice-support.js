'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, ChannelType } = require('discord.js');
const db      = require('../db');
const session = require('../session');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('voice-support')
    .setDescription('Verwaltet den Voice-Support-Warteraum (nur Admins)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub
      .setName('setup')
      .setDescription('Richtet den Support-Warteraum ein')
      .addChannelOption(opt => opt
        .setName('warteraum')
        .setDescription('Voice-Kanal, der als Support-Warteraum überwacht wird')
        .addChannelTypes(ChannelType.GuildVoice)
        .setRequired(true))
      .addChannelOption(opt => opt
        .setName('benachrichtigungskanal')
        .setDescription('Textkanal, in dem das Team benachrichtigt wird')
        .addChannelTypes(ChannelType.GuildText)
        .setRequired(true))
      .addRoleOption(opt => opt
        .setName('team_rolle')
        .setDescription('Rolle, die gepingt wird und deren Beitritt in den Warteraum die Wartemusik stoppt')
        .setRequired(false)))
    .addSubcommand(sub => sub
      .setName('status')
      .setDescription('Zeigt die aktuelle Konfiguration und ob gerade jemand wartet'))
    .addSubcommand(sub => sub
      .setName('deaktivieren')
      .setDescription('Deaktiviert das Voice-Support-System')),

  async execute(interaction) {
    const sub     = interaction.options.getSubcommand();
    const guildId = interaction.guild.id;
    await db.ensureGuild(guildId);

    if (sub === 'setup') {
      const warteraum     = interaction.options.getChannel('warteraum', true);
      const notifyChannel = interaction.options.getChannel('benachrichtigungskanal', true);
      const teamRolle     = interaction.options.getRole('team_rolle');

      await db.updateConfig(guildId, {
        waiting_channel_id: warteraum.id,
        notify_channel_id:  notifyChannel.id,
        staff_role_id:      teamRolle ? teamRolle.id : null,
      });

      const embed = new EmbedBuilder()
        .setTitle('✅ Voice-Support eingerichtet')
        .setColor(0x57F287)
        .addFields(
          { name: 'Warteraum',              value: `${warteraum}`,                        inline: true },
          { name: 'Benachrichtigungskanal', value: `${notifyChannel}`,                    inline: true },
          { name: 'Team-Rolle',             value: teamRolle ? `${teamRolle}` : 'Keine',  inline: true },
        );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    if (sub === 'status') {
      const cfg = await db.getConfig(guildId);
      if (!cfg?.waiting_channel_id) {
        return interaction.reply({ content: 'ℹ️ Voice-Support ist nicht eingerichtet. Nutze `/voice-support setup`.', ephemeral: true });
      }

      const embed = new EmbedBuilder()
        .setTitle('🎧 Voice-Support-Status')
        .setColor(0x5865F2)
        .addFields(
          { name: 'Warteraum',              value: `<#${cfg.waiting_channel_id}>`, inline: true },
          { name: 'Benachrichtigungskanal', value: cfg.notify_channel_id ? `<#${cfg.notify_channel_id}>` : 'Nicht gesetzt', inline: true },
          { name: 'Team-Rolle',             value: cfg.staff_role_id ? `<@&${cfg.staff_role_id}>` : 'Keine', inline: true },
          { name: 'Gerade aktiv',           value: session.isActive(guildId) ? '✅ Ja, Bot spielt Wartemusik' : '⭕ Nein', inline: true },
        );
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    // sub === 'deaktivieren'
    session.stopSession(guildId);
    await db.updateConfig(guildId, { waiting_channel_id: null, notify_channel_id: null, staff_role_id: null });
    return interaction.reply({ content: '🛑 Voice-Support wurde deaktiviert.', ephemeral: true });
  },
};
