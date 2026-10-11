'use strict';

// Periodically checks "Bewerbung" tickets for staleness: open for more than
// a month with nobody — opener or staff — having written anything in that
// time (see db.getStaleOpenTicketsByCategory). A ticket with recent
// back-and-forth is a "normale Konversation" and is left alone no matter
// how old it is; only the quiet ones get an automatic nudge asking whether
// the applicant is still interested.

const { EmbedBuilder } = require('discord.js');
const db     = require('./db');
const logger = require('../../utils/logger');

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // hourly is plenty for a month-scale threshold
const STALE_DAYS = 30;
const APPLICATION_CATEGORY = 'Bewerbung';

async function checkStaleApplicationTickets(client) {
  const staleBefore = new Date(Date.now() - STALE_DAYS * 24 * 60 * 60 * 1000);
  const tickets = await db.getStaleOpenTicketsByCategory(APPLICATION_CATEGORY, staleBefore);

  for (const ticket of tickets) {
    const guild   = client.guilds.cache.get(ticket.guild_id);
    const channel = guild?.channels.cache.get(ticket.channel_id);
    if (!channel) {
      logger.warn(`Tickets: Interesse-Nachfrage für Ticket #${ticket.ticket_number} übersprungen (Kanal nicht gefunden).`);
      await db.markInterestCheckSent(ticket.id);
      continue;
    }

    const embed = new EmbedBuilder()
      .setTitle('📋 Besteht noch Interesse?')
      .setDescription(
        `Dieses Bewerbungsticket ist seit über ${STALE_DAYS} Tagen ohne Rückmeldung offen. ` +
        'Besteht noch Interesse an der Bewerbung? Bitte melde dich kurz zurück, ansonsten wird das Ticket ggf. geschlossen.',
      )
      .setColor(0xFEE75C)
      .setTimestamp();

    try {
      await channel.send({ content: `<@${ticket.user_id}>`, embeds: [embed] });
    } catch (err) {
      logger.error(`Tickets: Interesse-Nachfrage für Ticket #${ticket.ticket_number} fehlgeschlagen:`, err.message);
    }
    await db.markInterestCheckSent(ticket.id);
  }
}

let intervalHandle = null;

function start(client) {
  if (intervalHandle) return;
  checkStaleApplicationTickets(client).catch(err => logger.error('Tickets: Interesse-Check fehlgeschlagen:', err.message));
  intervalHandle = setInterval(() => {
    checkStaleApplicationTickets(client).catch(err => logger.error('Tickets: Interesse-Check fehlgeschlagen:', err.message));
  }, CHECK_INTERVAL_MS);
}

module.exports = { start };
