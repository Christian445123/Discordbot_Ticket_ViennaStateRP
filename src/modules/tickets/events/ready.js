'use strict';

const { Events } = require('discord.js');
const scheduler = require('../scheduler');

module.exports = {
  name: Events.ClientReady,
  once: true,

  execute(client) {
    scheduler.start(client);
  },
};
