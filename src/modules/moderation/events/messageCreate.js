'use strict';

const { Events } = require('discord.js');
const automod = require('../automod');

module.exports = {
  name: Events.MessageCreate,
  execute: automod.handleMessage,
};
