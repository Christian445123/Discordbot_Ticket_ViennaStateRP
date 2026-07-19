'use strict';

const { Events } = require('discord.js');
const logger = require('../../utils/logger');

module.exports = {
  name: Events.ClientReady,
  once: true,

  execute(client) {
    logger.info(`✅ Bot eingeloggt als ${client.user.tag}`);
    client.user.setActivity('Tickets verwalten', { type: 3 /* Watching */ });
  },
};
