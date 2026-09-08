'use strict';

// Builds the ticket-creation panel embed + category dropdown from a guild's
// configured categories, shared by /setup and /panel so both stay in sync.

const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const db     = require('./db');
const logger = require('../../utils/logger');

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

// Re-renders the already-posted panel (see /panel senden / /setup) after a
// category was added/edited/removed/reordered, so the dropdown + embed
// fields never go stale — called from every category-mutating entry point
// (slash command and web panel alike). A guild that never posted a panel
// (no panel_channel_id/panel_message_id yet) is a silent no-op, and any
// failure (channel or message deleted, missing permissions) is only logged —
// this must never break the category change itself.
async function refreshPanel(discordClient, guildId) {
  try {
    const guildCfg = await db.getGuild(guildId);
    if (!guildCfg?.panel_channel_id || !guildCfg?.panel_message_id) return;

    const guild = discordClient.guilds.cache.get(guildId);
    if (!guild) return;

    const channel = await guild.channels.fetch(guildCfg.panel_channel_id).catch(() => null);
    if (!channel) return;
    const message = await channel.messages.fetch(guildCfg.panel_message_id).catch(() => null);
    if (!message) return;

    await message.edit(await buildPanelPayload(guild));
  } catch (err) {
    logger.error('Ticket-Panel aktualisieren fehlgeschlagen:', err.message);
  }
}

module.exports = { buildPanelPayload, refreshPanel };
