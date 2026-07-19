'use strict';

const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const db        = require('../../database/db');
const ticketLog = require('../ticketLog');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('kategorie')
    .setDescription('Ändert die Kategorie des aktuellen Tickets (nur Staff)')
    .addStringOption(opt =>
      opt.setName('neue_kategorie')
         .setDescription('Neue Kategorie für dieses Ticket')
         .setRequired(true)
         .setAutocomplete(true)),

  async autocomplete(interaction) {
    const focused    = interaction.options.getFocused().toLowerCase();
    const categories = db.getCategories.all(interaction.guild.id);
    const choices = categories
      .filter(c => c.name.toLowerCase().includes(focused))
      .slice(0, 25)
      .map(c => ({ name: `${c.emoji} ${c.name}`, value: c.name }));
    await interaction.respond(choices);
  },

  async execute(interaction) {
    const ticket = db.getTicketByChannel.get(interaction.channel.id);
    if (!ticket) {
      return interaction.reply({ content: '❌ Dieser Kanal ist kein Ticket.', ephemeral: true });
    }

    const guildCfg = db.getGuild.get(interaction.guild.id);
    const isAdmin  = interaction.member.permissions.has(PermissionFlagsBits.Administrator);
    const isStaff  = isAdmin
      || (guildCfg?.staff_role_id && interaction.member.roles.cache.has(guildCfg.staff_role_id));
    if (!isStaff) {
      return interaction.reply({ content: '❌ Nur Staff kann die Kategorie ändern.', ephemeral: true });
    }

    const newCategory = interaction.options.getString('neue_kategorie', true);
    if (!db.getCategoryByName.get(interaction.guild.id, newCategory)) {
      return interaction.reply({ content: `❌ Kategorie **${newCategory}** ist nicht konfiguriert.`, ephemeral: true });
    }

    const oldCategory = ticket.category;
    if (newCategory === oldCategory) {
      return interaction.reply({ content: 'ℹ️ Das Ticket hat bereits diese Kategorie.', ephemeral: true });
    }

    db.updateTicketCategory.run(newCategory, ticket.id);

    try {
      await interaction.channel.setTopic(
        `Ticket von ${ticket.username} | Kategorie: ${newCategory} | ID: ${ticket.id}`,
      );
    } catch (_) { /* missing permission to edit topic — not critical */ }

    const embed = new EmbedBuilder()
      .setTitle('🏷️ Kategorie geändert')
      .setDescription(`Von **${oldCategory}** zu **${newCategory}**`)
      .setColor(0x5865F2)
      .setFooter({ text: `Geändert von ${interaction.user.tag}` })
      .setTimestamp();

    await interaction.reply({ embeds: [embed] });

    await ticketLog.logCategoryChanged(interaction.client, interaction.guild.id, {
      ticket, oldCategory, newCategory, changedByTag: interaction.user.tag,
    });
  },
};
