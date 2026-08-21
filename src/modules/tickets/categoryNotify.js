'use strict';

// Applies a category's configured ping target + automatic message when a new
// ticket is created (see component.js's createTicketChannel).

const { EmbedBuilder } = require('discord.js');
const db     = require('./db');
const logger = require('../../utils/logger');

function buildPingMention(categoryCfg) {
  if (!categoryCfg) return null;
  if (categoryCfg.ping_type === 'role') return `<@&${categoryCfg.ping_target_id}>`;
  if (categoryCfg.ping_type === 'user') return `<@${categoryCfg.ping_target_id}>`;
  return null;
}

// Gold accent (distinct from the blurple welcome embed) marks this as the
// automatic follow-up rather than the ticket's main welcome message.
function autoMessageEmbed(categoryCfg) {
  return new EmbedBuilder()
    .setAuthor({ name: `${categoryCfg.emoji} ${categoryCfg.name}` })
    .setTitle('📨 Automatische Nachricht')
    .setDescription(categoryCfg.auto_message)
    .setColor(0xFEE75C)
    .setFooter({ text: 'ℹ️ Automatisch gesendet' });
}

async function applyCategoryExtras(discordClient, guildId, { categoryName, channel, userId }) {
  const categoryCfg = await db.getCategoryByName(guildId, categoryName);
  if (!categoryCfg?.auto_message) return;

  if (categoryCfg.auto_message_channel && channel) {
    try {
      await channel.send({ embeds: [autoMessageEmbed(categoryCfg)] });
    } catch (err) {
      logger.error('Automatische Kanal-Nachricht fehlgeschlagen:', err.message);
    }
  }

  if (categoryCfg.auto_message_dm && userId) {
    try {
      const user = await discordClient.users.fetch(userId);
      await user.send({ embeds: [autoMessageEmbed(categoryCfg)] });
    } catch (err) {
      logger.error('Automatische DM fehlgeschlagen (evtl. DMs deaktiviert):', err.message);
    }
  }
}

module.exports = { buildPingMention, applyCategoryExtras };
