'use strict';

// Fires for a kick, a ban, AND a voluntary leave alike — Discord's gateway
// doesn't distinguish between them at this event, and for this purpose it
// doesn't matter why the membership ended: any open ticket the member
// leaves behind gets auto-closed the same way either way.

const { Events } = require('discord.js');
const db = require('../db');
const { closeTicket } = require('../component');

module.exports = {
  name: Events.GuildMemberRemove,

  async execute(member) {
    const openTickets = await db.getOpenTicketsByUser(member.guild.id, member.id);
    if (!openTickets.length) return;

    const username = member.user?.tag;

    for (const ticket of openTickets) {
      const channel = member.guild.channels.cache.get(ticket.channel_id);
      if (!channel) continue; // channel already gone somehow — nothing left to close

      await closeTicket(
        member.client,
        member.guild,
        channel,
        ticket,
        'System (Ersteller hat den Server verlassen)',
        null,
        `Dieses Ticket wurde automatisch geschlossen, da ${username || ticket.username} den Server verlassen hat oder entfernt wurde.`,
      ).catch(() => {});
    }
  },
};
