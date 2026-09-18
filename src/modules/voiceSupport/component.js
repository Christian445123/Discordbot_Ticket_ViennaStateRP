'use strict';

// Handles the "🎫 Supportticket erstellen" button sent by
// waitRoom.sendClosedNotice() as a DM (with a channel-chat fallback) when
// someone joins the voice waiting room while support is closed — reuses
// the ticket module's own createTicketChannel() so the resulting ticket
// behaves exactly like one opened through the normal panel (questions,
// welcome message, ping roles, Auslastung refresh, everything).
//
// Since this button is usually clicked from a DM, the interaction itself
// has no guild — the customId carries the guild ID instead (see
// waitRoom.js), and that resolved guild is passed explicitly into
// createTicketChannel().

const db        = require('./db');
const ticketsDb = require('../tickets/db');
const { createTicketChannel } = require('../tickets/component');
const { CREATE_TICKET_BUTTON_PREFIX } = require('./waitRoom');

async function component(interaction) {
  if (!interaction.isButton() || !interaction.customId.startsWith(CREATE_TICKET_BUTTON_PREFIX)) return;

  const guildId = interaction.customId.slice(CREATE_TICKET_BUTTON_PREFIX.length);
  const guild   = interaction.client.guilds.cache.get(guildId);
  if (!guild) {
    return interaction.reply({
      content: '❌ Der Server konnte nicht gefunden werden (bin ich dort noch Mitglied?).',
      ephemeral: true,
    });
  }

  const cfg = await db.getConfig(guildId);
  if (!cfg?.ticket_category) {
    return interaction.reply({
      content: '❌ Für Support-Tickets ist noch keine Ticket-Kategorie konfiguriert. Bitte einen Admin im Webpanel (Tab „Voice-Support“) einrichten lassen.',
      ephemeral: true,
    });
  }

  const category = await ticketsDb.getCategoryByName(guildId, cfg.ticket_category);
  if (!category) {
    return interaction.reply({
      content: '❌ Die konfigurierte Ticket-Kategorie existiert nicht mehr. Bitte einen Admin im Webpanel neu einrichten lassen.',
      ephemeral: true,
    });
  }

  await createTicketChannel(
    interaction,
    cfg.ticket_category,
    'Ticket über den Voice-Support-Warteraum erstellt (Support war zu diesem Zeitpunkt geschlossen).',
    guild,
  );
}

module.exports = { component };
