'use strict';

// Builds the ticket-creation panel embed + category dropdown from a guild's
// configured categories, shared by /setup and /panel so both stay in sync.

const { EmbedBuilder, ActionRowBuilder, StringSelectMenuBuilder } = require('discord.js');
const db     = require('./db');
const logger = require('../../utils/logger');

const DEFAULT_DESCRIPTION =
  'Benötigst du Hilfe oder hast ein Anliegen?\nWähle eine Kategorie aus dem Menü und erstelle ein Ticket.';

// Same "Auslastung" thresholds as the web admin dashboard's loadBadge/
// workloadBarColor (src/web/public/js/admin.js) — kept in sync manually
// since one runs in the browser and the other in the bot process.
function loadIndicator(openCount, totalOpen) {
  if (!totalOpen) return '🟢';
  const percent = Math.round((openCount / totalOpen) * 100);
  if (percent > 75) return '🟣';
  if (percent > 50) return '🔴';
  if (percent > 25) return '🟡';
  return '🟢';
}

function formatMinutes(minutes) {
  if (minutes == null) return 'noch keine geschlossenen Tickets';
  if (minutes < 60) return `${minutes} Min.`;
  const hours = Math.floor(minutes / 60);
  const rest  = minutes % 60;
  if (hours < 24) return rest ? `${hours} Std. ${rest} Min.` : `${hours} Std.`;
  const days      = Math.floor(hours / 24);
  const restHours = hours % 24;
  return restHours ? `${days} Tag(e) ${restHours} Std.` : `${days} Tag(e)`;
}

async function buildPanelPayload(guild) {
  const [guildCfg, categories, openCounts, avgResolutionMinutes] = await Promise.all([
    db.getGuild(guild.id),
    db.getCategories(guild.id),
    db.getOpenCountsByCategory(guild.id),
    db.getAvgResolutionMinutes(guild.id),
  ]);

  const openCountByCategory = new Map(openCounts.map(r => [r.category, r.open_count]));
  const totalOpen = openCounts.reduce((sum, r) => sum + r.open_count, 0);

  const embed = new EmbedBuilder()
    .setTitle('🎫 Support-Tickets')
    .setDescription(guildCfg?.panel_description || DEFAULT_DESCRIPTION)
    .setColor(0x5865F2)
    .setFooter({ text: guild.name });

  if (guildCfg?.panel_image_url) embed.setImage(guildCfg.panel_image_url);

  categories.forEach(c => {
    const openCount = openCountByCategory.get(c.name) || 0;
    const percent   = totalOpen ? Math.round((openCount / totalOpen) * 100) : 0;
    const loadLine  = `${loadIndicator(openCount, totalOpen)} Auslastung: ${openCount} offen${totalOpen ? ` · ${percent}%` : ''}`;
    const lines     = [c.description, c.locked ? '🔒 Gesperrt — aktuell keine neuen Tickets möglich' : null, loadLine]
      .filter(Boolean);

    embed.addFields({
      name:  `${c.locked ? '🔒 ' : ''}${c.emoji} ${c.name}`,
      value: lines.join('\n'),
    });
  });

  embed.addFields({
    name:  '📊 Gesamtauslastung',
    value: `Ø Bearbeitungsdauer: ${formatMinutes(avgResolutionMinutes)}`,
  });

  // Locked categories (e.g. a closed Bewerbungsphase) are shown above for
  // transparency but dropped from the dropdown entirely, since Discord
  // select menus can't disable individual options — component.js re-checks
  // categoryCfg.locked too, in case a stale/cached panel still submits one.
  const openCategories = categories.filter(c => !c.locked);
  const select = new StringSelectMenuBuilder()
    .setCustomId('ticket_category')
    .setPlaceholder(openCategories.length ? 'Kategorie auswählen…' : 'Aktuell keine Kategorie verfügbar')
    .setDisabled(openCategories.length === 0)
    .addOptions(
      openCategories.length
        ? openCategories.map(c => ({ label: c.name, value: c.name, emoji: c.emoji || undefined }))
        : [{ label: 'Keine Kategorie verfügbar', value: '_none_' }],
    );

  return { embeds: [embed], components: [new ActionRowBuilder().addComponents(select)] };
}

// Re-renders the already-posted panel (see /panel senden / /setup) after a
// category was added/edited/removed/reordered, or a ticket was opened/closed
// (the Auslastung numbers depend on open-ticket counts), so the dropdown +
// embed fields never go stale — called from every category-mutating entry
// point (slash command and web panel alike) plus ticket create/close. A
// guild that never posted a panel
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
