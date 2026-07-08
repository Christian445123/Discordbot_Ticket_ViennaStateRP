'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ChannelType,
} = require('discord.js');
const db = require('../../database/db');

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
         .setRequired(false)),

  async execute(interaction) {
    await interaction.deferReply({ ephemeral: true });

    const { guild, options } = interaction;

    db.ensureGuild.run(guild.id);

    const updates = {};
    const category   = options.getChannel('kategorie');
    const logChannel = options.getChannel('log_kanal');
    const staffRole  = options.getRole('staff_rolle');
    const panelChan  = options.getChannel('panel_kanal');

    if (category)   updates.ticket_category_id = category.id;
    if (logChannel) updates.log_channel_id      = logChannel.id;
    if (staffRole)  updates.staff_role_id        = staffRole.id;

    if (Object.keys(updates).length > 0) db.updateGuild(guild.id, updates);

    // Post panel if panel channel given
    if (panelChan) {
      const embed = new EmbedBuilder()
        .setTitle('🎫 Support-Tickets')
        .setDescription(
          'Benötigst du Hilfe oder hast ein Anliegen?\n' +
          'Wähle eine Kategorie aus dem Menü und erstelle ein Ticket.'
        )
        .setColor(0x5865F2)
        .setFooter({ text: guild.name });

      const select = new StringSelectMenuBuilder()
        .setCustomId('ticket_category')
        .setPlaceholder('Kategorie auswählen…')
        .addOptions([
          { label: 'Support',         value: 'Support',         emoji: '🛠️' },
          { label: 'Bug-Report',      value: 'Bug-Report',      emoji: '🐛' },
          { label: 'Bewerbung',       value: 'Bewerbung',       emoji: '📋' },
          { label: 'Beschwerde',      value: 'Beschwerde',      emoji: '⚠️' },
          { label: 'Allgemein',       value: 'Allgemein',       emoji: '💬' },
        ]);

      const row = new ActionRowBuilder().addComponents(select);

      const msg = await panelChan.send({ embeds: [embed], components: [row] });

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
