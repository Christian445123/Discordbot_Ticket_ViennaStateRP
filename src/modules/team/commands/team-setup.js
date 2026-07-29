'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, EmbedBuilder } = require('discord.js');
const db = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('team-setup')
    .setDescription('Richtet die Teamverwaltung ein (nur Admins)')
    .setDefaultMemberPermissions(PermissionFlagsBits.Administrator)
    .addChannelOption(opt =>
      opt.setName('log_kanal')
         .setDescription('Kanal für Inaktivitäts-Meldungen')
         .addChannelTypes(ChannelType.GuildText)
         .setRequired(false))
    .addIntegerOption(opt =>
      opt.setName('inaktivitaet_tage')
         .setDescription('Ab wie vielen Tagen ohne Nachricht gilt ein Mitglied als inaktiv (Standard: 14)')
         .setRequired(false)),

  async execute(interaction) {
    const logChannel = interaction.options.getChannel('log_kanal');
    const days        = interaction.options.getInteger('inaktivitaet_tage');

    const updates = {};
    if (logChannel) updates.log_channel_id = logChannel.id;
    if (days) updates.inactivity_days = days;
    if (Object.keys(updates).length > 0) await db.upsertTeamSettings(interaction.guild.id, updates);

    const settings = await db.getTeamSettings(interaction.guild.id);
    const embed = new EmbedBuilder()
      .setTitle('✅ Team-Setup')
      .setColor(0x57F287)
      .addFields(
        { name: 'Log-Kanal', value: settings?.log_channel_id ? `<#${settings.log_channel_id}>` : 'Nicht gesetzt', inline: true },
        { name: 'Inaktivität ab', value: `${settings?.inactivity_days ?? 14} Tagen`, inline: true },
      );
    return interaction.reply({ embeds: [embed], ephemeral: true });
  },
};
