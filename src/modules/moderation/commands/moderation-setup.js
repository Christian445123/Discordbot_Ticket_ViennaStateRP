'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const db = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('moderation-setup')
    .setDescription('Richtet die Moderation ein (nur Admins)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(opt =>
      opt.setName('log_kanal')
         .setDescription('Kanal für Moderations-Logs (Fälle, Automod, Appeals)')
         .addChannelTypes(ChannelType.GuildText)
         .setRequired(false)),

  async execute(interaction) {
    const logChannel = interaction.options.getChannel('log_kanal');
    const updates = {};
    if (logChannel) updates.log_channel_id = logChannel.id;

    if (Object.keys(updates).length > 0) await db.upsertSettings(interaction.guild.id, updates);

    const settings = await db.getSettings(interaction.guild.id);
    const embed = new EmbedBuilder()
      .setTitle('✅ Moderations-Setup')
      .setColor(0x57F287)
      .addFields({
        name: 'Log-Kanal',
        value: settings?.log_channel_id ? `<#${settings.log_channel_id}>` : 'Nicht gesetzt',
        inline: true,
      });

    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
