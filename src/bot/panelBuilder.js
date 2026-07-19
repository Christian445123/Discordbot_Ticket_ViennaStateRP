'use strict';

// Builds the ticket-creation panel embed + category dropdown from a guild's
// configured categories, shared by /setup and /panel so both stay in sync.

const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const db = require('../database/db');

const DEFAULT_DESCRIPTION =
  'Benötigst du Hilfe oder hast ein Anliegen?\nWähle eine Kategorie aus dem Menü und erstelle ein Ticket.';

async function buildPanelPayload(guild) {
  const guildCfg   = await db.getGuild(guild.id);
  const categories = await db.getCategories(guild.id);

  const embed = new EmbedBuilder()
    .setTitle('🎫 Support-Tickets')
    .setDescription(guildCfg?.panel_description || DEFAULT_DESCRIPTION)
    .setColor(0x5865F2)
    .setFooter({ text: guild.name });

  if (guildCfg?.panel_image_url) embed.setImage(guildCfg.panel_image_url);

  const zeroWidthSpace = String.fromCharCode(8203); // Discord embed field values can't be empty

  categories.forEach(c => {
    embed.addFields({
      name:  `${c.emoji} ${c.name}`,
      value: c.description || zeroWidthSpace,
    });
  });

  const select = new StringSelectMenuBuilder()
    .setCustomId('ticket_category')
    .setPlaceholder('Kategorie auswählen…')
    .addOptions(categories.map(c => ({ label: c.name, value: c.name, emoji: c.emoji || undefined })));

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
}

module.exports = { buildPanelPayload };
