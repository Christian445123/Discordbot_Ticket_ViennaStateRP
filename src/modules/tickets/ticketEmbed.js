'use strict';

// Edits the "📌 Status" field on a ticket's welcome embed (the message
// posted when the ticket channel was created — see component.js's
// createTicketChannel) whenever its claimed/on-hold state changes. Shared by
// the Discord buttons (component.js, which already has the message via the
// button's own interaction) and the web panel's claim/hold routes
// (routes.js, which have to fetch it by the stored tickets.welcome_message_id
// instead), so every surface renders the exact same status text the same way.

const { EmbedBuilder } = require('discord.js');
const logger = require('../../utils/logger');

// Priority mirrors ticketDisplayStatus() in admin.js/admin-ticket.js/
// routes.js: on-hold and claimed are independent flags (a ticket can be
// both), but the embed only has room to show one line, so on-hold wins.
function computeStatusText(ticket) {
  if (ticket.on_hold_by_id) return `🟠 Warte auf Rückmeldung (${ticket.on_hold_by_name})`;
  if (ticket.claimed_by_id) return `🟡 In Bearbeitung (${ticket.claimed_by_name})`;
  return '🟢 Offen';
}

function buildStatusEmbed(oldEmbed, statusText) {
  const fields = oldEmbed.fields.map(f =>
    f.name === '📌 Status' ? { ...f, value: statusText } : f,
  );
  return EmbedBuilder.from(oldEmbed).setFields(fields);
}

// Embed-only refresh (claim doesn't touch the button row). For the on-hold
// toggle, which also swaps the button's label, component.js builds the
// embed itself via buildStatusEmbed() and edits both in one call instead.
async function refreshWelcomeEmbedStatus(message, ticket) {
  try {
    const [oldEmbed] = message.embeds;
    if (!oldEmbed) return;
    await message.edit({ embeds: [buildStatusEmbed(oldEmbed, computeStatusText(ticket))] });
  } catch (err) {
    logger.error('Welcome-Embed-Status aktualisieren fehlgeschlagen:', err.message);
  }
}

module.exports = { computeStatusText, buildStatusEmbed, refreshWelcomeEmbedStatus };
