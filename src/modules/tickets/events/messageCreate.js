'use strict';

const { Events } = require('discord.js');
const db = require('../db');

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
  },
};
