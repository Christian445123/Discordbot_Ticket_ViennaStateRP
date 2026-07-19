'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType } = require('discord.js');
const db           = require('../../database/db');
const panelBuilder = require('../panelBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('panel')
    .setDescription('Sendet oder aktualisiert das Ticket-Panel (nur Admins)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addSubcommand(sub => sub
      .setName('senden')
      .setDescription('Postet das Ticket-Panel in einem Kanal')
      .addChannelOption(opt =>
        opt.setName('kanal')
           .setDescription('Zielkanal für das Panel')
           .addChannelTypes(ChannelType.GuildText)
           .setRequired(true)))
    .addSubcommand(sub => sub
      .setName('aktualisieren')
      .setDescription('Aktualisiert das zuletzt gesendete Panel (z.B. nach Kategorie-Änderungen)')),

  async execute(interaction) {
    const { guild } = interaction;
    db.ensureGuildWithDefaults(guild.id);
    const sub = interaction.options.getSubcommand();

    if (sub === 'senden') {
      const channel = interaction.options.getChannel('kanal');
      const payload = panelBuilder.buildPanelPayload(guild);
      const msg     = await channel.send(payload);

      db.updateGuild(guild.id, { panel_channel_id: channel.id, panel_message_id: msg.id });
      return interaction.reply({ content: `✅ Panel in ${channel} gesendet.`, ephemeral: true });
    }

    // sub === 'aktualisieren'
    const guildCfg = db.getGuild.get(guild.id);
    if (!guildCfg?.panel_channel_id || !guildCfg?.panel_message_id) {
      return interaction.reply({
        content: '❌ Es wurde noch kein Panel gesendet. Nutze `/panel senden`.',
        ephemeral: true,
      });
    }

    try {
      const channel = await guild.channels.fetch(guildCfg.panel_channel_id);
      const message = await channel.messages.fetch(guildCfg.panel_message_id);
      await message.edit(panelBuilder.buildPanelPayload(guild));
      return interaction.reply({ content: '✅ Panel aktualisiert.', ephemeral: true });
    } catch (err) {
      return interaction.reply({
        content: `❌ Panel konnte nicht aktualisiert werden (wurde es gelöscht?): ${err.message}`,
        ephemeral: true,
      });
    }
  },
};
