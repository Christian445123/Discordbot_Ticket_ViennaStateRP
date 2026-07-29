'use strict';

const {
  SlashCommandBuilder,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} = require('discord.js');
const db = require('../db');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('close')
    .setDescription('Schließt das aktuelle Ticket'),

  async execute(interaction) {
    const ticket = await db.getTicketByChannel(interaction.channel.id);

    if (!ticket) {
      return interaction.reply({ content: '❌ Dieser Kanal ist kein Ticket.', ephemeral: true });
    }

    if (ticket.status === 'closed') {
      return interaction.reply({ content: '❌ Dieses Ticket ist bereits geschlossen.', ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setTitle('🔒 Ticket schließen?')
      .setDescription('Möchtest du dieses Ticket wirklich schließen?')
      .setColor(0xFEE75C);

    const confirm = new ButtonBuilder()
      .setCustomId(`confirm_close_${ticket.id}`)
      .setLabel('Ja, schließen')
      .setStyle(ButtonStyle.Danger);

    const cancel = new ButtonBuilder()
      .setCustomId('cancel_close')
      .setLabel('Abbrechen')
      .setStyle(ButtonStyle.Secondary);

    const row = new ActionRowBuilder().addComponents(confirm, cancel);

    await interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  },
};
