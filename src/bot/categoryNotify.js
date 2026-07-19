'use strict';

// Applies a category's configured ping target + automatic message when a new
// ticket is created. Shared by the Discord-side and web-side creation flows
// so both behave identically.

const { EmbedBuilder } = require('discord.js');
const db     = require('../database/db');
const logger = require('../utils/logger');

function buildPingMention(categoryCfg) {
  if (!categoryCfg) return null;
  if (categoryCfg.ping_type === 'role') return `<@&${categoryCfg.ping_target_id}>`;
  if (categoryCfg.ping_type === 'user') return `<@${categoryCfg.ping_target_id}>`;
  return null;
}

async function applyCategoryExtras(discordClient, guildId, { categoryName, channel, userId }) {
  const categoryCfg = db.getCategoryByName.get(guildId, categoryName);
  if (!categoryCfg?.auto_message) return;

  if (categoryCfg.auto_message_channel && channel) {
    try {
      await channel.send({
        embeds: [new EmbedBuilder()
          .setTitle(`${categoryCfg.emoji} ${categoryCfg.name}`)
          .setDescription(categoryCfg.auto_message)
          .setColor(0x5865F2)],
      });
    } catch (err) {
      logger.error('Automatische Kanal-Nachricht fehlgeschlagen:', err.message);
    }
  }

  if (categoryCfg.auto_message_dm && userId) {
    try {
      const user = await discordClient.users.fetch(userId);
      await user.send(`**${categoryCfg.emoji} ${categoryCfg.name}**\n${categoryCfg.auto_message}`);
    } catch (err) {
      logger.error('Automatische DM fehlgeschlagen (evtl. DMs deaktiviert):', err.message);
    }
  }
}

module.exports = { buildPingMention, applyCategoryExtras };
