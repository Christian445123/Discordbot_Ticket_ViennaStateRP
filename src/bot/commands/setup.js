'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ChannelType,
} = require('discord.js');
const db           = require('../../database/db');
const panelBuilder = require('../panelBuilder');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('setup')
    .setDescription('Richtet das Ticket-System ein (nur Admins)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(opt =>
      opt.setName('kategorie')
         .setDescription('Kategorie, in der Ticket-Kanäle erstellt werden')
         .addChannelTypes(ChannelType.GuildCategory)
         .setRequired(false))
    .addChannelOption(opt =>
      opt.setName('log_kanal')
         .setDescription('Kanal für Ticket-Logs')
         .addChannelTypes(ChannelType.GuildText)
         .setRequired(false))
    .addRoleOption(opt =>
      opt.setName('staff_rolle')
         .setDescription('Rolle, die alle Tickets sehen darf')
         .setRequired(false))
    .addChannelOption(opt =>
      opt.setName('panel_kanal')
         .setDescription('Kanal, in dem das Ticket-Panel gepostet wird')
         .addChannelTypes(ChannelType.GuildText)
         .setRequired(false))
    .addStringOption(opt =>
      opt.setName('panel_beschreibung')
         .setDescription('Eigener Beschreibungstext für das Panel')
         .setRequired(false))
    .addStringOption(opt =>
      opt.setName('panel_bild')
         .setDescription('Bild-URL, die im Panel angezeigt wird')
         .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const { guild, options } = interaction;

    db.ensureGuildWithDefaults(guild.id);

    const updates    = {};
    const category   = options.getChannel('kategorie');
    const logChannel = options.getChannel('log_kanal');
    const staffRole  = options.getRole('staff_rolle');
    const panelChan  = options.getChannel('panel_kanal');
    const panelDesc  = options.getString('panel_beschreibung');
    const panelImage = options.getString('panel_bild');

    if (category)   updates.ticket_category_id = category.id;
    if (logChannel) updates.log_channel_id      = logChannel.id;
    if (staffRole)  updates.staff_role_id       = staffRole.id;
    if (panelDesc)  updates.panel_description   = panelDesc;
    if (panelImage) updates.panel_image_url     = panelImage;

    if (Object.keys(updates).length > 0) db.updateGuild(guild.id, updates);

    // Post panel if panel channel given
    if (panelChan) {
      const payload = panelBuilder.buildPanelPayload(guild);
      const msg     = await panelChan.send(payload);

      db.updateGuild(guild.id, {
        panel_channel_id:  panelChan.id,
        panel_message_id:  msg.id,
      });
    }

    const guildCfg = db.getGuild.get(guild.id);

    const status = new EmbedBuilder()
      .setTitle('✅ Setup abgeschlossen')
      .setColor(0x57F287)
      .addFields(
        { name: 'Ticket-Kategorie', value: guildCfg.ticket_category_id ? `<#${guildCfg.ticket_category_id}>` : 'Nicht gesetzt', inline: true },
        { name: 'Log-Kanal',        value: guildCfg.log_channel_id      ? `<#${guildCfg.log_channel_id}>`      : 'Nicht gesetzt', inline: true },
        { name: 'Staff-Rolle',      value: guildCfg.staff_role_id        ? `<@&${guildCfg.staff_role_id}>`      : 'Nicht gesetzt', inline: true },
        { name: 'Panel-Kanal',      value: guildCfg.panel_channel_id     ? `<#${guildCfg.panel_channel_id}>`    : 'Nicht gesetzt', inline: true },
      );

    await interaction.editReply({ embeds: [status] });
  },
};
