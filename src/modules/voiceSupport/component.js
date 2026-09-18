'use strict';

// Handles the "🎫 Supportticket erstellen" button posted by
// waitRoom.sendClosedNotice() when someone joins the voice waiting room
// while support is closed — reuses the ticket module's own
// createTicketChannel() so the resulting ticket behaves exactly like one
// opened through the normal panel (questions, welcome message, ping
// roles, Auslastung refresh, everything).

const db               = require('./db');
const ticketsDb        = require('../tickets/db');
const { createTicketChannel } = require('../tickets/component');
const { CREATE_TICKET_BUTTON_ID } = require('./waitRoom');

async function component(interaction) {
  if (!interaction.isButton() || interaction.customId !== CREATE_TICKET_BUTTON_ID) return;

  const guildId = interaction.guild.id;
  const cfg     = await db.getConfig(guildId);

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
  );
}

module.exports = { component };
