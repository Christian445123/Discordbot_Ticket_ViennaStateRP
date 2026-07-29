'use strict';

const { Events } = require('discord.js');
const jobs = require('../jobs');

module.exports = {
  name: Events.ClientReady,
  once: true,
  execute(client) {
    jobs.start(client);
  },
};
