'use strict';

const { Events } = require('discord.js');

module.exports = {
  name: Events.ClientReady,
  once: true,

  execute(client) {
    console.log(`✅ Bot eingeloggt als ${client.user.tag}`);
    client.user.setActivity('Tickets verwalten', { type: 3 /* Watching */ });
  },
};
