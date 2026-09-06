'use strict';

const { Events } = require('discord.js');
const db                = require('../db');
const ticketLog         = require('../ticketLog');
const { isTicketStaff } = require('../staffCheck');

module.exports = {
  name: Events.MessageCreate,

  async execute(message) {
    // Ignore bots and DMs
    if (message.author.bot || !message.guild) return;

    const ticket = await db.getTicketByChannel(message.channel.id);
    if (!ticket || ticket.status === 'closed') return;

    const attachments = message.attachments.map(a => ({ name: a.name, url: a.url }));

    await db.addMessage({
      ticket_id:   ticket.id,
      user_id:     message.author.id,
      username:    message.author.tag,
      avatar_url:  message.author.displayAvatarURL({ size: 64 }),
      content:     message.content || '',
      attachments: JSON.stringify(attachments),
    });

    // First staff reply auto-claims an unclaimed ticket ("In Bearbeitung" —
    // see db.js: not a stored status, just status='open' + claimed_by_id
    // set). Never fires for the ticket opener's own messages, and never
    // steals an existing explicit claim (claimTicketIfUnclaimed is a no-op
    // once someone already has it).
    if (message.author.id === ticket.user_id || !message.member) return;
    const guildCfg    = await db.getGuild(message.guild.id);
    const categoryCfg = await db.getCategoryByName(message.guild.id, ticket.category);
    if (!isTicketStaff(message.member, guildCfg, categoryCfg)) return;

    const claimed = await db.claimTicketIfUnclaimed(ticket.id, {
      claimedById: message.author.id, claimedByName: message.author.tag,
    });
    if (!claimed) return;

    await message.channel.send({
      content: `🖐️ ${message.author} hat automatisch übernommen (erste Antwort). Status: **In Bearbeitung**`,
    }).catch(() => {});

    await ticketLog.logTicketClaimed(message.client, message.guild.id, {
      ticket, claimedByTag: message.author.tag, auto: true,
    });
  },
};
